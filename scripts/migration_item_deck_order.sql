-- Persist ranked candidate ids for item-search swipes so each swipe doesn’t re-scan the whole catalog.

ALTER TABLE public.swipe_sessions
  ADD COLUMN IF NOT EXISTS item_deck_order UUID[];

COMMENT ON COLUMN public.swipe_sessions.item_deck_order IS
  'Pre-ranked outfit_candidates.id list for item_search_query sessions; avoids reloading the pool on every swipe.';
