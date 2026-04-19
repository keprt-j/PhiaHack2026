-- Item-first swipe: sessions scoped to a typed product query (e.g. "white pants").
-- Allows one open "style" session and one open "item" session per user.
--
-- If this failed with 23505 before, run from "DEDUPE" down after ADD COLUMN (idempotent).

ALTER TABLE public.swipe_sessions
  ADD COLUMN IF NOT EXISTS item_search_query TEXT;

COMMENT ON COLUMN public.swipe_sessions.item_search_query IS
  'When set, deck is filtered to looks that match this item search; style-profile Gemini hooks are skipped.';

-- ---------------------------------------------------------------------------
-- DEDUPE: partial unique indexes require at most one matching row per user.
-- Close older in-progress sessions; keep the newest by started_at (then id).
-- ---------------------------------------------------------------------------

UPDATE public.swipe_sessions AS s
SET completed_at = NOW()
FROM (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY started_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.swipe_sessions
    WHERE user_id IS NOT NULL
      AND completed_at IS NULL
      AND item_search_query IS NULL
  ) AS x
  WHERE x.rn > 1
) AS dup
WHERE s.id = dup.id;

UPDATE public.swipe_sessions AS s
SET completed_at = NOW()
FROM (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY started_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.swipe_sessions
    WHERE user_id IS NOT NULL
      AND completed_at IS NULL
      AND item_search_query IS NOT NULL
  ) AS x
  WHERE x.rn > 1
) AS dup
WHERE s.id = dup.id;

DROP INDEX IF EXISTS idx_swipe_sessions_one_open_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_sessions_one_open_default
  ON public.swipe_sessions (user_id)
  WHERE user_id IS NOT NULL AND completed_at IS NULL AND item_search_query IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_sessions_one_open_item
  ON public.swipe_sessions (user_id)
  WHERE user_id IS NOT NULL AND completed_at IS NULL AND item_search_query IS NOT NULL;
