-- Seed additional communities + 10 mock users + themed posts.
-- Run after fresh_install.sql (and optionally seed_fresh.sql).
-- Idempotent where practical via ON CONFLICT.
--
-- Mock user -> community (one join each; posts are in that community):
--   ari.lane.demo@phia.local      -> s/archive
--   mina.park.demo@phia.local     -> s/quietluxury
--   diego.vale.demo@phia.local    -> s/gorpcore
--   skye.rowan.demo@phia.local    -> s/y2k
--   nia.shore.demo@phia.local     -> s/coastal
--   theo.finch.demo@phia.local    -> s/darkacademia
--   soren.vale.demo@phia.local    -> s/scandinavian
--   lila.moss.demo@phia.local     -> s/boho
--   kade.nyx.demo@phia.local      -> s/techwear
--   jules.hart.demo@phia.local    -> s/retrosport

BEGIN;

-- 1) Simulate 10 new users to discover underserved community clusters.
WITH simulated_users AS (
  SELECT *
  FROM (
    VALUES
      ('archive nerd', ARRAY['archive','avant-garde','runway','editorial','deconstructed']::text[]),
      ('quiet luxury office', ARRAY['quiet-luxury','tailored','minimal','workwear','cashmere']::text[]),
      ('gorpcore commuter', ARRAY['gorpcore','outdoor','technical','utility','trail']::text[]),
      ('y2k nightlife', ARRAY['y2k','party','metallic','club','glam']::text[]),
      ('coastal capsule', ARRAY['coastal','linen','capsule','minimal','vacation']::text[]),
      ('dark academia reader', ARRAY['dark-academia','preppy','vintage','layered','oxford']::text[]),
      ('scandi monochrome', ARRAY['scandinavian','monochrome','minimal','neutral','clean']::text[]),
      ('boho market', ARRAY['boho','craft','artisan','festival','earth-tone']::text[]),
      ('techwear rider', ARRAY['techwear','cyber','functional','streetwear','waterproof']::text[]),
      ('retro sports', ARRAY['retro-sport','athleisure','varsity','sneakers','color-block']::text[])
  ) AS t(persona, tags)
),
community_candidates AS (
  SELECT
    persona,
    tags[1] AS slug_hint,
    tags
  FROM simulated_users
),
new_communities AS (
  SELECT
    CASE slug_hint
      WHEN 'archive' THEN 'Archive Core'
      WHEN 'quiet-luxury' THEN 'Quiet Luxury Circle'
      WHEN 'gorpcore' THEN 'Gorpcore Field Notes'
      WHEN 'y2k' THEN 'Y2K After Hours'
      WHEN 'coastal' THEN 'Coastal Capsule'
      WHEN 'dark-academia' THEN 'Dark Academia Club'
      WHEN 'scandinavian' THEN 'Scandi Minimalists'
      WHEN 'boho' THEN 'Boho Makers'
      WHEN 'techwear' THEN 'Techwear Grid'
      WHEN 'retro-sport' THEN 'Retro Sport Society'
      ELSE initcap(replace(slug_hint, '-', ' ')) || ' Collective'
    END AS name,
    CASE slug_hint
      WHEN 'quiet-luxury' THEN 'quietluxury'
      WHEN 'dark-academia' THEN 'darkacademia'
      WHEN 'retro-sport' THEN 'retrosport'
      ELSE replace(slug_hint, '-', '')
    END AS slug,
    ('Style space for ' || persona || ' looks.')::text AS description,
    tags
  FROM community_candidates
)
INSERT INTO public.communities (name, slug, description, member_count)
SELECT
  c.name,
  c.slug,
  c.description,
  (1200 + (row_number() OVER (ORDER BY c.slug) * 220))::int
FROM new_communities c
ON CONFLICT (slug) DO UPDATE
SET
  description = EXCLUDED.description,
  member_count = GREATEST(public.communities.member_count, EXCLUDED.member_count);

-- 2) Keep taxonomy fresh for all community names/slugs.
INSERT INTO public.community_taxonomy (community_id, trait, weight)
SELECT
  c.id,
  lower(trim(tok)),
  1
FROM public.communities c
CROSS JOIN LATERAL unnest(
  string_to_array(replace(replace(c.slug, '-', ' '), '_', ' '), ' ')
  || string_to_array(c.name, ' ')
) AS t(tok)
WHERE length(trim(tok)) > 2
ON CONFLICT (community_id, trait) DO NOTHING;

-- 3) Create 10 mock auth users, then enrich profiles.
WITH mock_users AS (
  SELECT *
  FROM (
    VALUES
      ('Ari Lane', 'ari.lane.demo@phia.local', ARRAY['archive','editorial','avant-garde']::text[]),
      ('Mina Park', 'mina.park.demo@phia.local', ARRAY['quiet-luxury','tailored','minimal']::text[]),
      ('Diego Vale', 'diego.vale.demo@phia.local', ARRAY['gorpcore','utility','outdoor']::text[]),
      ('Skye Rowan', 'skye.rowan.demo@phia.local', ARRAY['y2k','party','glam']::text[]),
      ('Nia Shore', 'nia.shore.demo@phia.local', ARRAY['coastal','linen','capsule']::text[]),
      ('Theo Finch', 'theo.finch.demo@phia.local', ARRAY['dark-academia','vintage','preppy']::text[]),
      ('Soren Vale', 'soren.vale.demo@phia.local', ARRAY['scandinavian','monochrome','neutral']::text[]),
      ('Lila Moss', 'lila.moss.demo@phia.local', ARRAY['boho','artisan','festival']::text[]),
      ('Kade Nyx', 'kade.nyx.demo@phia.local', ARRAY['techwear','cyber','functional']::text[]),
      ('Jules Hart', 'jules.hart.demo@phia.local', ARRAY['retro-sport','athleisure','varsity']::text[])
  ) AS t(display_name, email, tags)
),
mock_users_with_id AS (
  SELECT
    (
      substr(m, 1, 8) || '-' ||
      substr(m, 9, 4) || '-4' ||
      substr(m, 14, 3) || '-a' ||
      substr(m, 18, 3) || '-' ||
      substr(m, 21, 12)
    )::uuid AS id,
    display_name,
    email,
    tags
  FROM (
    SELECT md5(email) AS m, display_name, email, tags
    FROM mock_users
  ) x
)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT
  u.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  u.email,
  crypt('demo-password-123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.display_name),
  now(),
  now()
FROM mock_users_with_id u
ON CONFLICT (id) DO NOTHING;

-- Profile rows are created by trigger on auth.users insert. Update style-facing fields.
WITH mock_users AS (
  SELECT *
  FROM (
    VALUES
      ('Ari Lane', 'ari.lane.demo@phia.local', ARRAY['archive','editorial','avant-garde']::text[]),
      ('Mina Park', 'mina.park.demo@phia.local', ARRAY['quiet-luxury','tailored','minimal']::text[]),
      ('Diego Vale', 'diego.vale.demo@phia.local', ARRAY['gorpcore','utility','outdoor']::text[]),
      ('Skye Rowan', 'skye.rowan.demo@phia.local', ARRAY['y2k','party','glam']::text[]),
      ('Nia Shore', 'nia.shore.demo@phia.local', ARRAY['coastal','linen','capsule']::text[]),
      ('Theo Finch', 'theo.finch.demo@phia.local', ARRAY['dark-academia','vintage','preppy']::text[]),
      ('Soren Vale', 'soren.vale.demo@phia.local', ARRAY['scandinavian','monochrome','neutral']::text[]),
      ('Lila Moss', 'lila.moss.demo@phia.local', ARRAY['boho','artisan','festival']::text[]),
      ('Kade Nyx', 'kade.nyx.demo@phia.local', ARRAY['techwear','cyber','functional']::text[]),
      ('Jules Hart', 'jules.hart.demo@phia.local', ARRAY['retro-sport','athleisure','varsity']::text[])
  ) AS t(display_name, email, tags)
),
mock_users_with_id AS (
  SELECT
    (
      substr(m, 1, 8) || '-' ||
      substr(m, 9, 4) || '-4' ||
      substr(m, 14, 3) || '-a' ||
      substr(m, 18, 3) || '-' ||
      substr(m, 21, 12)
    )::uuid AS id,
    display_name,
    email,
    tags
  FROM (
    SELECT md5(email) AS m, display_name, email, tags
    FROM mock_users
  ) x
)
UPDATE public.profiles p
SET
  display_name = u.display_name,
  username = replace(split_part(u.email, '@', 1), '.', '_'),
  bio = 'Demo profile focused on ' || array_to_string(u.tags, ', ') || '.',
  style_tags = u.tags,
  has_completed_onboarding = true,
  updated_at = now()
FROM mock_users_with_id u
WHERE p.id = u.id;

-- 4) Add each mock user to one matching community.
WITH user_to_community AS (
  SELECT *
  FROM (
    VALUES
      ('ari.lane.demo@phia.local', 'archive'),
      ('mina.park.demo@phia.local', 'quietluxury'),
      ('diego.vale.demo@phia.local', 'gorpcore'),
      ('skye.rowan.demo@phia.local', 'y2k'),
      ('nia.shore.demo@phia.local', 'coastal'),
      ('theo.finch.demo@phia.local', 'darkacademia'),
      ('soren.vale.demo@phia.local', 'scandinavian'),
      ('lila.moss.demo@phia.local', 'boho'),
      ('kade.nyx.demo@phia.local', 'techwear'),
      ('jules.hart.demo@phia.local', 'retrosport')
  ) AS t(email, community_slug)
),
uids AS (
  SELECT
    (
      substr(m, 1, 8) || '-' ||
      substr(m, 9, 4) || '-4' ||
      substr(m, 14, 3) || '-a' ||
      substr(m, 18, 3) || '-' ||
      substr(m, 21, 12)
    )::uuid AS user_id,
    community_slug
  FROM (
    SELECT md5(email) AS m, community_slug
    FROM user_to_community
  ) x
)
INSERT INTO public.community_members (user_id, community_id)
SELECT
  u.user_id,
  c.id
FROM uids u
JOIN public.communities c ON c.slug = u.community_slug
ON CONFLICT (user_id, community_id) DO NOTHING;

-- 5) Create two themed posts per mock user in their community.
WITH post_seed AS (
  SELECT *
  FROM (
    VALUES
      ('ari.lane.demo@phia.local', 'archive', 'Archive layering test drive', 'Testing deconstructed proportions with a monochrome base and sharp accessories.', ARRAY['archive','editorial','avant-garde']::text[], 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=1200&h=1400&fit=crop'),
      ('ari.lane.demo@phia.local', 'archive', 'Runway-to-street translation', 'Toned down a runway silhouette into something wearable for daytime city walks.', ARRAY['runway','deconstructed','street']::text[], 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&h=1400&fit=crop'),
      ('mina.park.demo@phia.local', 'quietluxury', 'Quiet luxury office fit', 'Soft tailoring, clean tote, and no logos. Trying to keep the palette neutral.', ARRAY['quiet-luxury','tailored','minimal']::text[], 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&h=1400&fit=crop'),
      ('mina.park.demo@phia.local', 'quietluxury', 'Cashmere + trousers combo', 'Favorite high-low mix for workdays that still feels elevated.', ARRAY['cashmere','office','minimal']::text[], 'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=1200&h=1400&fit=crop'),
      ('diego.vale.demo@phia.local', 'gorpcore', 'Rain-ready commuter kit', 'Layered shell + utility vest setup that survived a full wet commute.', ARRAY['gorpcore','utility','waterproof']::text[], 'https://images.unsplash.com/photo-1548883354-94bcfe321cbb?w=1200&h=1400&fit=crop'),
      ('diego.vale.demo@phia.local', 'gorpcore', 'Trail shoes in the city', 'Trying technical footwear with cleaner everyday pieces.', ARRAY['outdoor','technical','commuter']::text[], 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=1200&h=1400&fit=crop'),
      ('skye.rowan.demo@phia.local', 'y2k', 'Y2K chrome night look', 'Metallic mini + chunky boots for a late-night set.', ARRAY['y2k','metallic','party']::text[], 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&h=1400&fit=crop'),
      ('skye.rowan.demo@phia.local', 'y2k', 'Throwback glam check', 'Color-tinted shades and playful accessories all night.', ARRAY['glam','club','throwback']::text[], 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1200&h=1400&fit=crop'),
      ('nia.shore.demo@phia.local', 'coastal', 'Linen capsule weekday', 'Three-piece capsule in sand + white for hot weather.', ARRAY['coastal','linen','capsule']::text[], 'https://images.unsplash.com/photo-1495385794356-15371f348c31?w=1200&h=1400&fit=crop'),
      ('nia.shore.demo@phia.local', 'coastal', 'Light layers by the coast', 'Breathable layering with a relaxed silhouette and flat sandals.', ARRAY['vacation','relaxed','minimal']::text[], 'https://images.unsplash.com/photo-1523359346063-d879354c0ea5?w=1200&h=1400&fit=crop'),
      ('theo.finch.demo@phia.local', 'darkacademia', 'Dark academia library fit', 'Heavy knit, oxford shirt, and vintage wool overcoat.', ARRAY['dark-academia','vintage','layered']::text[], 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=1200&h=1400&fit=crop'),
      ('theo.finch.demo@phia.local', 'darkacademia', 'Preppy archive moodboard', 'Playing with classic prep shapes in a darker color story.', ARRAY['preppy','oxford','classic']::text[], 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=1200&h=1400&fit=crop'),
      ('soren.vale.demo@phia.local', 'scandinavian', 'Scandi monochrome layers', 'Graphite-on-black layering with clean footwear.', ARRAY['scandinavian','monochrome','clean']::text[], 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&h=1400&fit=crop'),
      ('soren.vale.demo@phia.local', 'scandinavian', 'Neutral texture stack', 'Cream and stone tones with texture doing all the work.', ARRAY['neutral','minimal','texture']::text[], 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=1200&h=1400&fit=crop'),
      ('lila.moss.demo@phia.local', 'boho', 'Boho market Saturday', 'Flowy layers, artisan tote, and earthy accessories.', ARRAY['boho','artisan','earth-tone']::text[], 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=1200&h=1400&fit=crop'),
      ('lila.moss.demo@phia.local', 'boho', 'Festival texture mix', 'Fringe plus crochet details for a weekend outdoor set.', ARRAY['festival','craft','layered']::text[], 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200&h=1400&fit=crop'),
      ('kade.nyx.demo@phia.local', 'techwear', 'Techwear commute build', 'Weather shell + harness details for bike-first commuting.', ARRAY['techwear','functional','cyber']::text[], 'https://images.unsplash.com/photo-1542293787938-4d273c9c9f53?w=1200&h=1400&fit=crop'),
      ('kade.nyx.demo@phia.local', 'techwear', 'Night grid fit', 'Reflective details and utility pockets after dark.', ARRAY['streetwear','waterproof','utility']::text[], 'https://images.unsplash.com/photo-1516762689617-e1cffcef479d?w=1200&h=1400&fit=crop'),
      ('jules.hart.demo@phia.local', 'retrosport', 'Retro sport warmup', 'Old-school track jacket with modern wide-leg trousers.', ARRAY['retro-sport','varsity','athleisure']::text[], 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=1200&h=1400&fit=crop'),
      ('jules.hart.demo@phia.local', 'retrosport', 'Color-block weekend set', 'Leaned into vintage team colors with cleaner sneakers.', ARRAY['color-block','sneakers','throwback']::text[], 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&h=1400&fit=crop')
  ) AS t(email, community_slug, title, content, tags, image_url)
),
post_user_ids AS (
  SELECT
    (
      substr(m, 1, 8) || '-' ||
      substr(m, 9, 4) || '-4' ||
      substr(m, 14, 3) || '-a' ||
      substr(m, 18, 3) || '-' ||
      substr(m, 21, 12)
    )::uuid AS user_id,
    community_slug,
    title,
    content,
    tags,
    image_url
  FROM (
    SELECT md5(email) AS m, community_slug, title, content, tags, image_url
    FROM post_seed
  ) x
)
INSERT INTO public.posts (user_id, community_id, title, content, image_url, outfit_tags, upvotes, comments_count, is_trending)
SELECT
  p.user_id,
  c.id,
  p.title,
  p.content,
  p.image_url,
  p.tags,
  (8 + ((row_number() OVER (ORDER BY p.title)) % 40))::int,
  (1 + ((row_number() OVER (ORDER BY p.title)) % 9))::int,
  ((row_number() OVER (ORDER BY p.title)) % 3 = 0)
FROM post_user_ids p
JOIN public.communities c ON c.slug = p.community_slug
ON CONFLICT DO NOTHING;

COMMIT;
