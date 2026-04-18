-- Extra feed posts for the original 6 communities (minimal, streetwear, sustainable,
-- vintage, workstyle, athleisure). Uses existing demo auth users from seed_mock_communities.sql.
--
-- Idempotent: removes rows we inserted previously via content marker, then re-inserts.
-- Prerequisite: seed_mock_communities.sql (or any *.demo@phia.local users in auth.users).
--
-- Run in Supabase SQL editor.

BEGIN;

DELETE FROM public.posts
WHERE content LIKE '%__seed_core_posts_v1__%';

WITH v(email, slug, title, content, image_url, tags, upvotes, comments_count, is_trending) AS (
  VALUES
    -- minimal
    (
      'mina.park.demo@phia.local',
      'minimal',
      'Capsule whites for spring',
      'Three-piece rotation: ivory tee, bone trousers, soft blazer. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&h=1400&fit=crop',
      ARRAY['minimal', 'neutral', 'capsule']::text[],
      34,
      5,
      true
    ),
    (
      'soren.vale.demo@phia.local',
      'minimal',
      'One-tone layering day',
      'All cream stack with texture-only contrast. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1485968579169-a6e9f404ecf4?w=1200&h=1400&fit=crop',
      ARRAY['minimal', 'scandinavian', 'layered']::text[],
      28,
      2,
      false
    ),
    (
      'nia.shore.demo@phia.local',
      'minimal',
      'Sand and stone weekend',
      'Linen + cotton only; keeping hardware invisible. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1523359346063-d879354c0ea5?w=1200&h=1400&fit=crop',
      ARRAY['minimal', 'coastal', 'linen']::text[],
      41,
      4,
      true
    ),
    (
      'theo.finch.demo@phia.local',
      'minimal',
      'Quiet desk uniform',
      'No-logo shirt, charcoal trousers, one watch. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=1400&fit=crop',
      ARRAY['minimal', 'workwear', 'tailored']::text[],
      19,
      1,
      false
    ),
    -- streetwear
    (
      'diego.vale.demo@phia.local',
      'streetwear',
      'Cargo + shell city kit',
      'Water-resistant layers for wet commutes. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1542293787938-4d273c9c9f53?w=1200&h=1400&fit=crop',
      ARRAY['streetwear', 'techwear', 'utility']::text[],
      62,
      8,
      true
    ),
    (
      'kade.nyx.demo@phia.local',
      'streetwear',
      'Night grid run',
      'Reflective hits + black base for after-dark errands. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1550614000-4b9519e02a7d?w=1200&h=1400&fit=crop',
      ARRAY['streetwear', 'neon', 'night']::text[],
      55,
      6,
      true
    ),
    (
      'skye.rowan.demo@phia.local',
      'streetwear',
      'Sneaker-forward fit check',
      'Wide-leg denim + statement trainers + cropped jacket. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=1200&h=1400&fit=crop',
      ARRAY['streetwear', 'sneakers', 'denim']::text[],
      48,
      7,
      false
    ),
    (
      'jules.hart.demo@phia.local',
      'streetwear',
      'Varsity energy, toned down',
      'Letter jacket over plain hoodie — campus without cosplay. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1516762689617-e1cffcef479d?w=1200&h=1400&fit=crop',
      ARRAY['streetwear', 'varsity', 'layered']::text[],
      33,
      3,
      false
    ),
    -- sustainable
    (
      'lila.moss.demo@phia.local',
      'sustainable',
      'Thrifted texture stack',
      'Wool cardigan + vintage tee + repaired denim. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=1200&h=1400&fit=crop',
      ARRAY['sustainable', 'thrift', 'layered']::text[],
      71,
      9,
      true
    ),
    (
      'nia.shore.demo@phia.local',
      'sustainable',
      'Natural dye linen day',
      'Low-impact dyes + line-dried finish. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=1200&h=1400&fit=crop',
      ARRAY['sustainable', 'linen', 'natural']::text[],
      44,
      4,
      false
    ),
    (
      'mina.park.demo@phia.local',
      'sustainable',
      'Slow fashion wishlist',
      'Brands with repair programs only this season. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1551488852-0801751ac1f4?w=1200&h=1400&fit=crop',
      ARRAY['sustainable', 'outdoor', 'heritage']::text[],
      38,
      2,
      false
    ),
    (
      'soren.vale.demo@phia.local',
      'sustainable',
      'One-bag travel fits',
      'Packable merino + one pair of shoes for a week. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=1200&h=1400&fit=crop',
      ARRAY['sustainable', 'minimal', 'travel']::text[],
      52,
      5,
      true
    ),
    -- vintage
    (
      'theo.finch.demo@phia.local',
      'vintage',
      '70s suede mood',
      'Found jacket + high-rise denim + square toe. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&h=1400&fit=crop',
      ARRAY['vintage', '70s', 'suede']::text[],
      67,
      10,
      true
    ),
    (
      'skye.rowan.demo@phia.local',
      'vintage',
      'Y2K throwback grid',
      'Metallic bag + low-rise jeans + baby tee. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1200&h=1400&fit=crop',
      ARRAY['vintage', 'y2k', 'throwback']::text[],
      59,
      8,
      true
    ),
    (
      'lila.moss.demo@phia.local',
      'vintage',
      'Flea market leather score',
      'Conditioned jacket + silk scarf from the same stall. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1490114538077-0a7f8cb49891?w=1200&h=1400&fit=crop',
      ARRAY['vintage', 'leather', 'grunge']::text[],
      46,
      4,
      false
    ),
    (
      'ari.lane.demo@phia.local',
      'vintage',
      'Archival runway reference',
      'Silhouette study from an old collection — wearable version. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&h=1400&fit=crop',
      ARRAY['vintage', 'editorial', 'archive']::text[],
      31,
      3,
      false
    ),
    -- workstyle
    (
      'mina.park.demo@phia.local',
      'workstyle',
      'Soft power Monday',
      'Knit blazer + silk shirt + tailored trousers. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=1200&h=1400&fit=crop',
      ARRAY['workstyle', 'tailored', 'professional']::text[],
      73,
      11,
      true
    ),
    (
      'theo.finch.demo@phia.local',
      'workstyle',
      'Oxford + pleats rotation',
      'Academic office vibe without looking costume-y. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=1200&h=1400&fit=crop',
      ARRAY['workstyle', 'preppy', 'layered']::text[],
      54,
      6,
      false
    ),
    (
      'soren.vale.demo@phia.local',
      'workstyle',
      'Monochrome client day',
      'Charcoal suit + black knit — no tie. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&h=1400&fit=crop',
      ARRAY['workstyle', 'minimal', 'formal']::text[],
      61,
      7,
      true
    ),
    (
      'diego.vale.demo@phia.local',
      'workstyle',
      'Creative office Friday',
      'Structured overshirt + relaxed chinos + one statement sneaker. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=1200&h=1400&fit=crop',
      ARRAY['workstyle', 'creative', 'smart-casual']::text[],
      39,
      4,
      false
    ),
    -- athleisure
    (
      'jules.hart.demo@phia.local',
      'athleisure',
      'Track jacket brunch',
      'Retro top + wide trouser + clean trainers. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=1200&h=1400&fit=crop',
      ARRAY['athleisure', 'retro', 'sport']::text[],
      64,
      9,
      true
    ),
    (
      'kade.nyx.demo@phia.local',
      'athleisure',
      'Bike commute base layer',
      'Merino tee + stretch pants + packable shell. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=1200&h=1400&fit=crop',
      ARRAY['athleisure', 'commuter', 'technical']::text[],
      47,
      5,
      false
    ),
    (
      'skye.rowan.demo@phia.local',
      'athleisure',
      'Pilates-to-coffee fit',
      'Soft bra top + oversized zip + flared pant. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&h=1400&fit=crop',
      ARRAY['athleisure', 'soft', 'weekend']::text[],
      56,
      6,
      true
    ),
    (
      'lila.moss.demo@phia.local',
      'athleisure',
      'Outdoor stretch Saturday',
      'Fleece + leggings + trail shoe for a long walk. __seed_core_posts_v1__',
      'https://images.unsplash.com/photo-1551488852-0801751ac1f4?w=1200&h=1400&fit=crop',
      ARRAY['athleisure', 'outdoor', 'comfort']::text[],
      42,
      3,
      false
    )
)
INSERT INTO public.posts (
  user_id,
  community_id,
  title,
  content,
  image_url,
  outfit_tags,
  upvotes,
  comments_count,
  is_trending
)
SELECT
  u.id,
  c.id,
  v.title,
  v.content,
  v.image_url,
  v.tags,
  v.upvotes,
  v.comments_count,
  v.is_trending
FROM v
JOIN auth.users u ON lower(u.email) = lower(v.email)
JOIN public.communities c ON c.slug = v.slug;

COMMIT;
