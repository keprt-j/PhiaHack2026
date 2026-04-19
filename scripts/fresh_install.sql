-- PhiaHack — full reset: drop app tables and recreate the current schema (single source of truth).
-- Run in Supabase SQL Editor (or psql). Then run seed_fresh.sql (and optional seed_core_community_posts / seed_mock_communities).
-- No separate migration files: new environments use this script only.
-- WARNING: Destroys all data in these tables.

-- ---------------------------------------------------------------------------
-- 1. Drop (dependents first)
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

DROP TABLE IF EXISTS public.swipe_events CASCADE;
DROP TABLE IF EXISTS public.swipe_sessions CASCADE;
DROP TABLE IF EXISTS public.candidate_embeddings CASCADE;
DROP TABLE IF EXISTS public.post_votes CASCADE;
DROP TABLE IF EXISTS public.posts CASCADE;
DROP TABLE IF EXISTS public.community_members CASCADE;
DROP TABLE IF EXISTS public.swipes CASCADE;
DROP TABLE IF EXISTS public.community_taxonomy CASCADE;
DROP TABLE IF EXISTS public.user_style_profiles CASCADE;
DROP TABLE IF EXISTS public.style_twins CASCADE;
DROP TABLE IF EXISTS public.outfit_candidates CASCADE;
DROP TABLE IF EXISTS public.outfits CASCADE;
DROP TABLE IF EXISTS public.communities CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  style_tags TEXT[] DEFAULT '{}',
  has_completed_onboarding BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_url TEXT,
  cover_url TEXT,
  member_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Single outfit pool for swipe deck + recommendations (replaces legacy `outfits` duplicate)
CREATE TABLE public.outfit_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  brand_name TEXT,
  price_range TEXT,
  style_tags TEXT[] DEFAULT '{}',
  category TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'seed' CHECK (source_type IN ('seed', 'retail_scrape', 'social_scrape', 'web_gemini')),
  source_platform TEXT,
  source_context JSONB DEFAULT '{}'::jsonb,
  freshness_score NUMERIC DEFAULT 1,
  classifier_output JSONB,
  image_hash TEXT,
  is_trending BOOLEAN DEFAULT FALSE,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_url)
);

CREATE INDEX idx_outfit_candidates_tags ON public.outfit_candidates USING GIN (style_tags);
CREATE INDEX idx_outfit_candidates_brand ON public.outfit_candidates (brand_name);
CREATE INDEX idx_outfit_candidates_source ON public.outfit_candidates (source_type);
CREATE INDEX idx_outfit_candidates_image_hash ON public.outfit_candidates (image_hash)
  WHERE image_hash IS NOT NULL;

-- Item swipe: token-AND match over catalog text (see lib/ranking/item-match-fetch.ts)
CREATE OR REPLACE FUNCTION public.match_outfit_candidates_by_item_query(search_q text, result_limit int DEFAULT 450)
RETURNS SETOF public.outfit_candidates
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH
  raw_toks AS (
    SELECT trim(t) AS piece
    FROM unnest(string_to_array(lower(regexp_replace(coalesce(search_q, ''), '[^a-zA-Z0-9\s''-]', ' ', 'g')), ' ')) AS t
  ),
  tokens AS (
    SELECT DISTINCT regexp_replace(piece, '[^a-z0-9-]+', '', 'g') AS tok
    FROM raw_toks
    WHERE length(regexp_replace(piece, '[^a-z0-9-]+', '', 'g')) >= 2
      AND regexp_replace(piece, '[^a-z0-9-]+', '', 'g') NOT IN (
        'the','a','an','for','and','or','with','in','on','at','to','of','my','your','some','any','looking','find','want'
      )
  ),
  tok_count AS (SELECT count(*)::int AS n FROM tokens),
  occ AS (
    SELECT
      oc.id,
      lower(
        coalesce(oc.title, '') || ' ' || coalesce(oc.description, '') || ' ' ||
        coalesce((SELECT string_agg(lower(x), ' ') FROM unnest(oc.style_tags) AS x), '') || ' ' ||
        coalesce(oc.classifier_output::text, '')
      ) AS hay
    FROM public.outfit_candidates oc
  )
  SELECT oc.*
  FROM public.outfit_candidates oc
  INNER JOIN occ ON occ.id = oc.id
  CROSS JOIN tok_count tc
  WHERE tc.n > 0
    AND NOT EXISTS (
      SELECT 1
      FROM tokens tok
      WHERE occ.hay NOT LIKE '%' || tok.tok || '%'
    )
  ORDER BY oc.freshness_score DESC NULLS LAST
  LIMIT result_limit;
$$;

COMMENT ON FUNCTION public.match_outfit_candidates_by_item_query(text, int) IS
  'Item swipe: rows where every token from search_q appears in title/description/tags/classifier text.';

GRANT EXECUTE ON FUNCTION public.match_outfit_candidates_by_item_query(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_outfit_candidates_by_item_query(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_outfit_candidates_by_item_query(text, int) TO anon;

CREATE TABLE public.community_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, community_id)
);

CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id UUID REFERENCES public.communities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT,
  image_url TEXT,
  outfit_tags TEXT[] DEFAULT '{}',
  upvotes INTEGER DEFAULT 0,
  reaction_love INTEGER NOT NULL DEFAULT 0,
  reaction_cry INTEGER NOT NULL DEFAULT 0,
  reaction_neutral INTEGER NOT NULL DEFAULT 0,
  reaction_wow INTEGER NOT NULL DEFAULT 0,
  reaction_fire INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  is_trending BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.post_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('love', 'cry', 'neutral', 'wow', 'fire')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);

CREATE TABLE public.style_twins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Legacy hub still reads `swipes`; outfit_id points at outfit_candidates.id
CREATE TABLE public.swipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outfit_id UUID NOT NULL REFERENCES public.outfit_candidates(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('left', 'right', 'super')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, outfit_id)
);

CREATE TABLE public.community_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  trait TEXT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 1,
  UNIQUE (community_id, trait)
);

CREATE INDEX idx_community_taxonomy_trait ON public.community_taxonomy (trait);

CREATE TABLE public.candidate_embeddings (
  candidate_id UUID PRIMARY KEY REFERENCES public.outfit_candidates(id) ON DELETE CASCADE,
  embedding_meta JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.swipe_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_session_id TEXT,
  target_count INTEGER NOT NULL DEFAULT 12,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  synthesis_result JSONB,
  style_journal JSONB DEFAULT '[]'::jsonb,
  style_guidance JSONB,
  reddit_profile_seed TEXT,
  item_search_query TEXT,
  item_deck_order UUID[],
  CONSTRAINT swipe_sessions_user_or_guest CHECK (
    user_id IS NOT NULL OR guest_session_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX idx_swipe_sessions_guest
  ON public.swipe_sessions (guest_session_id)
  WHERE guest_session_id IS NOT NULL;

CREATE INDEX idx_swipe_sessions_user ON public.swipe_sessions (user_id);

-- One open "style" deck and one open "item search" deck per user (duplicate fetches / Strict Mode)
CREATE UNIQUE INDEX idx_swipe_sessions_one_open_default
  ON public.swipe_sessions (user_id)
  WHERE user_id IS NOT NULL AND completed_at IS NULL AND item_search_query IS NULL;

CREATE UNIQUE INDEX idx_swipe_sessions_one_open_item
  ON public.swipe_sessions (user_id)
  WHERE user_id IS NOT NULL AND completed_at IS NULL AND item_search_query IS NOT NULL;

CREATE TABLE public.swipe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.swipe_sessions(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.outfit_candidates(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('left', 'right', 'super')),
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 100),
  dwell_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, position)
);

CREATE INDEX idx_swipe_events_session ON public.swipe_events (session_id);

CREATE TABLE public.user_style_profiles (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  traits JSONB NOT NULL DEFAULT '{}',
  preferred_brands TEXT[] DEFAULT '{}',
  disliked_brands TEXT[] DEFAULT '{}',
  profile_prompt TEXT,
  classifier_snapshot JSONB,
  confidence NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outfit_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.style_twins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipe_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_style_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Communities are viewable by everyone" ON public.communities FOR SELECT USING (true);

CREATE POLICY "Outfit candidates are viewable by everyone"
  ON public.outfit_candidates FOR SELECT USING (true);

CREATE POLICY "Memberships are viewable by everyone" ON public.community_members FOR SELECT USING (true);
CREATE POLICY "Users can join communities" ON public.community_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can leave communities" ON public.community_members FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Posts are viewable by everyone" ON public.posts FOR SELECT USING (true);
CREATE POLICY "Users can create posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Votes are viewable by everyone" ON public.post_votes FOR SELECT USING (true);
CREATE POLICY "Users can vote" ON public.post_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can change vote" ON public.post_votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can remove vote" ON public.post_votes FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Follows are viewable by everyone" ON public.style_twins FOR SELECT USING (true);
CREATE POLICY "Users can follow" ON public.style_twins FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users can unfollow" ON public.style_twins FOR DELETE USING (auth.uid() = follower_id);

CREATE POLICY "Users can view own swipes" ON public.swipes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own swipes" ON public.swipes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own swipes" ON public.swipes FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Candidate embeddings viewable by everyone"
  ON public.candidate_embeddings FOR SELECT USING (true);

CREATE POLICY "Users manage own swipe sessions"
  ON public.swipe_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view swipe events for own sessions"
  ON public.swipe_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.swipe_sessions s
      WHERE s.id = swipe_events.session_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert swipe events for own sessions"
  ON public.swipe_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.swipe_sessions s
      WHERE s.id = swipe_events.session_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "User style profiles are viewable by everyone"
  ON public.user_style_profiles FOR SELECT USING (true);

CREATE POLICY "Users upsert own style profile"
  ON public.user_style_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own style profile"
  ON public.user_style_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Community taxonomy is viewable by everyone"
  ON public.community_taxonomy FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- 4. Post reactions: keep aggregate columns in sync (SECURITY DEFINER bypasses RLS)
-- ---------------------------------------------------------------------------

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

CREATE TRIGGER trg_post_votes_reaction_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.post_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_post_reaction_counts();

-- ---------------------------------------------------------------------------
-- 5. Auth: auto-create profile row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
