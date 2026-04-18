-- Gemini style exploration journal + guidance for post–5-swipe deep dives (Reddit / profile handoff)
ALTER TABLE public.swipe_sessions
  ADD COLUMN IF NOT EXISTS style_journal JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.swipe_sessions
  ADD COLUMN IF NOT EXISTS style_guidance JSONB;

ALTER TABLE public.swipe_sessions
  ADD COLUMN IF NOT EXISTS reddit_profile_seed TEXT;

COMMENT ON COLUMN public.swipe_sessions.style_journal IS 'Append-only log: intro/refine entries with Gemini JSON + timestamps';
COMMENT ON COLUMN public.swipe_sessions.style_guidance IS 'Latest prefer_style_tags, specific_ideas, general_every_n, etc.';
COMMENT ON COLUMN public.swipe_sessions.reddit_profile_seed IS 'Final paragraph for external style apps (e.g. Reddit)';
