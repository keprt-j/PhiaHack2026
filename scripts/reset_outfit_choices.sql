-- Reset script for the swipe deck.
-- Run in Supabase SQL editor. Each block is independent — comment out what you don't want.
--
-- swipe_events.candidate_id has ON DELETE CASCADE, so deleting outfit_candidates
-- automatically removes the related swipe rows. swipe_sessions are kept unless
-- you explicitly clear them in step 3.

------------------------------------------------------------
-- 1) Drop everything Gemini + Google Search inserted (web_gemini source).
--    This is the usual "reset" after iterating on prompts / vision filters.
------------------------------------------------------------
DELETE FROM public.outfit_candidates
WHERE source_type = 'web_gemini';

------------------------------------------------------------
-- 2) Wipe ALL swipe progress (events + sessions) so users start fresh next load.
--    Safe even if step 1 already cascaded most events away.
------------------------------------------------------------
DELETE FROM public.swipe_events;
DELETE FROM public.swipe_sessions;

------------------------------------------------------------
-- 3) Optional hard reset: also delete EVERY outfit candidate, including seeds.
--    Re-run scripts/seed_fresh.sql afterwards to repopulate the base 27 cards.
------------------------------------------------------------
-- DELETE FROM public.outfit_candidates;

------------------------------------------------------------
-- 4) Optional: clear style-onboarding journals / guidance attached to sessions
--    you didn't already drop in step 2. No-op if step 2 ran.
------------------------------------------------------------
-- UPDATE public.swipe_sessions
-- SET style_journal = NULL,
--     style_guidance = NULL,
--     reddit_profile_seed = NULL,
--     completed_at = NULL;

-- Verify
SELECT
  source_type,
  COUNT(*) AS rows
FROM public.outfit_candidates
GROUP BY source_type
ORDER BY source_type;

SELECT COUNT(*) AS swipe_events_remaining FROM public.swipe_events;
SELECT COUNT(*) AS swipe_sessions_remaining FROM public.swipe_sessions;
