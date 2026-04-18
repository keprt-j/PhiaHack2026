-- Allow outfit_candidates rows discovered via Gemini + Google Search grounding.
-- Run in Supabase SQL editor if your DB was created before web_gemini existed.

ALTER TABLE public.outfit_candidates DROP CONSTRAINT IF EXISTS outfit_candidates_source_type_check;

ALTER TABLE public.outfit_candidates ADD CONSTRAINT outfit_candidates_source_type_check
  CHECK (source_type IN ('seed', 'retail_scrape', 'social_scrape', 'web_gemini'));
