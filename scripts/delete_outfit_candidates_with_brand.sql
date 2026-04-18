-- Delete all outfit_candidates rows that have a brand name set (e.g. retail scrapes).
-- Referencing swipe_events rows are removed via ON DELETE CASCADE on candidate_id.
--
-- Preview before deleting:
-- SELECT id, title, brand_name, source_type
-- FROM public.outfit_candidates
-- WHERE brand_name IS NOT NULL AND trim(brand_name) <> '';

DELETE FROM public.outfit_candidates
WHERE brand_name IS NOT NULL
  AND trim(brand_name) <> '';
