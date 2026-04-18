-- Speeds up the new content-hash dedup check in lib/ranking/web-discover.ts.
-- Safe to run repeatedly.

CREATE INDEX IF NOT EXISTS idx_outfit_candidates_image_hash
  ON public.outfit_candidates (image_hash)
  WHERE image_hash IS NOT NULL;

-- Optional: clear bogus URL-derived hashes that earlier ingest paths wrote into image_hash.
-- These are not real image content hashes and will block legitimate URL-different / image-same dedup
-- if they happen to collide. Comment out if you want to keep them.
UPDATE public.outfit_candidates
SET image_hash = NULL
WHERE source_type IN ('retail_scrape', 'social_scrape')
  AND image_hash IS NOT NULL
  AND length(image_hash) = 32;  -- imageHashFromUrl outputs sha256(url).slice(0,32)

-- Verify
SELECT source_type, COUNT(*) FILTER (WHERE image_hash IS NOT NULL) AS with_hash, COUNT(*) AS total
FROM public.outfit_candidates
GROUP BY source_type
ORDER BY source_type;
