-- Text match for item swipe: every significant token must appear somewhere on the card
-- (title, description, style_tags, or classifier JSON). Run once on Supabase SQL editor.

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
