-- Pinterest-style reactions: replace Reddit up/down with five emoji reaction types.
-- Run in Supabase SQL Editor after backup. Safe to re-run sections with IF NOT EXISTS where noted.

-- 1) Add per-reaction columns on posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS reaction_love INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reaction_cry INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reaction_neutral INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reaction_wow INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reaction_fire INTEGER NOT NULL DEFAULT 0;

-- 2) Migrate legacy vote rows before changing CHECK
UPDATE public.post_votes SET vote_type = 'love' WHERE vote_type = 'up';
UPDATE public.post_votes SET vote_type = 'neutral' WHERE vote_type = 'down';

ALTER TABLE public.post_votes DROP CONSTRAINT IF EXISTS post_votes_vote_type_check;

ALTER TABLE public.post_votes
  ADD CONSTRAINT post_votes_vote_type_check
  CHECK (vote_type IN ('love', 'cry', 'neutral', 'wow', 'fire'));

-- 3) Rebuild counts from post_votes (authoritative where votes exist)
UPDATE public.posts p
SET
  reaction_love = COALESCE(a.love, 0),
  reaction_cry = COALESCE(a.cry, 0),
  reaction_neutral = COALESCE(a.neutral, 0),
  reaction_wow = COALESCE(a.wow, 0),
  reaction_fire = COALESCE(a.fire, 0)
FROM (
  SELECT
    post_id,
    count(*) FILTER (WHERE vote_type = 'love') AS love,
    count(*) FILTER (WHERE vote_type = 'cry') AS cry,
    count(*) FILTER (WHERE vote_type = 'neutral') AS neutral,
    count(*) FILTER (WHERE vote_type = 'wow') AS wow,
    count(*) FILTER (WHERE vote_type = 'fire') AS fire
  FROM public.post_votes
  GROUP BY post_id
) a
WHERE p.id = a.post_id;

-- 4) Posts with no rows in post_votes: map legacy upvotes into "love" (seed totals)
UPDATE public.posts p
SET reaction_love = GREATEST(p.reaction_love, p.upvotes)
WHERE NOT EXISTS (SELECT 1 FROM public.post_votes v WHERE v.post_id = p.id);

-- 5) Sync aggregate upvotes = total reactions
UPDATE public.posts
SET upvotes = reaction_love + reaction_cry + reaction_neutral + reaction_wow + reaction_fire;

-- 6) Trigger: keep posts.* in sync when users react (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.sync_post_reaction_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d_love int := 0;
  d_cry int := 0;
  d_neutral int := 0;
  d_wow int := 0;
  d_fire int := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    pid := NEW.post_id;
    CASE NEW.vote_type
      WHEN 'love' THEN d_love := 1;
      WHEN 'cry' THEN d_cry := 1;
      WHEN 'neutral' THEN d_neutral := 1;
      WHEN 'wow' THEN d_wow := 1;
      WHEN 'fire' THEN d_fire := 1;
      ELSE NULL;
    END CASE;
  ELSIF TG_OP = 'DELETE' THEN
    pid := OLD.post_id;
    CASE OLD.vote_type
      WHEN 'love' THEN d_love := -1;
      WHEN 'cry' THEN d_cry := -1;
      WHEN 'neutral' THEN d_neutral := -1;
      WHEN 'wow' THEN d_wow := -1;
      WHEN 'fire' THEN d_fire := -1;
      ELSE NULL;
    END CASE;
  ELSE
    pid := NEW.post_id;
    CASE OLD.vote_type
      WHEN 'love' THEN d_love := d_love - 1;
      WHEN 'cry' THEN d_cry := d_cry - 1;
      WHEN 'neutral' THEN d_neutral := d_neutral - 1;
      WHEN 'wow' THEN d_wow := d_wow - 1;
      WHEN 'fire' THEN d_fire := d_fire - 1;
      ELSE NULL;
    END CASE;
    CASE NEW.vote_type
      WHEN 'love' THEN d_love := d_love + 1;
      WHEN 'cry' THEN d_cry := d_cry + 1;
      WHEN 'neutral' THEN d_neutral := d_neutral + 1;
      WHEN 'wow' THEN d_wow := d_wow + 1;
      WHEN 'fire' THEN d_fire := d_fire + 1;
      ELSE NULL;
    END CASE;
  END IF;

  UPDATE public.posts
  SET
    reaction_love = GREATEST(0, reaction_love + d_love),
    reaction_cry = GREATEST(0, reaction_cry + d_cry),
    reaction_neutral = GREATEST(0, reaction_neutral + d_neutral),
    reaction_wow = GREATEST(0, reaction_wow + d_wow),
    reaction_fire = GREATEST(0, reaction_fire + d_fire),
    upvotes = GREATEST(
      0,
      reaction_love + d_love + reaction_cry + d_cry + reaction_neutral + d_neutral + reaction_wow + d_wow + reaction_fire + d_fire
    )
  WHERE id = pid;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_votes_reaction_counts ON public.post_votes;
CREATE TRIGGER trg_post_votes_reaction_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.post_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_post_reaction_counts();
