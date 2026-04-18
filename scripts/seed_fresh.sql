-- Run after fresh_install.sql. Idempotent inserts use ON CONFLICT where safe.

-- Communities
INSERT INTO public.communities (name, slug, description, member_count) VALUES
('Minimal Aesthetics', 'minimal', 'Less is more. Clean lines and thoughtful simplicity.', 12500),
('Streetwear Culture', 'streetwear', 'Urban fashion, sneaker drops, and street style.', 34200),
('Sustainable Fashion', 'sustainable', 'Eco-conscious style and ethical brands.', 8700),
('Vintage Finds', 'vintage', 'Thrift scores, retro looks, and timeless pieces.', 15300),
('Work Style', 'workstyle', 'Professional looks that mean business.', 9800),
('Athleisure Life', 'athleisure', 'Where comfort meets style.', 21400)
ON CONFLICT DO NOTHING;

-- Outfit pool (seed cards for swipe + recommendations)
INSERT INTO public.outfit_candidates (
  title, description, image_url, brand_name, price_range, style_tags, category, source_type, is_trending
) VALUES
('Minimal Summer Set', 'Clean lines, breathable fabrics. Perfect for warm days.', 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&h=1200&fit=crop', 'Everlane', '$$', ARRAY['minimal', 'summer', 'casual'], 'casual', 'seed', true),
('Urban Street Look', 'Bold graphics meet comfort. City-ready attitude.', 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&h=1200&fit=crop', 'Off-White', '$$$', ARRAY['streetwear', 'urban', 'bold'], 'streetwear', 'seed', true),
('Boho Festival Vibes', 'Free-spirited layers and earthy tones.', 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&h=1200&fit=crop', 'Free People', '$$', ARRAY['boho', 'festival', 'layered'], 'bohemian', 'seed', false),
('Classic Tailored', 'Timeless elegance meets modern fit.', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=1200&fit=crop', 'Theory', '$$$', ARRAY['classic', 'tailored', 'professional'], 'formal', 'seed', true),
('Athleisure Flow', 'From gym to brunch seamlessly.', 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&h=1200&fit=crop', 'Lululemon', '$$', ARRAY['athleisure', 'sporty', 'comfort'], 'athletic', 'seed', false),
('Dark Academia', 'Scholarly charm with vintage appeal.', 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&h=1200&fit=crop', 'Ralph Lauren', '$$$', ARRAY['academia', 'vintage', 'intellectual'], 'vintage', 'seed', true),
('Coastal Casual', 'Relaxed beach-inspired everyday wear.', 'https://images.unsplash.com/photo-1523359346063-d879354c0ea5?w=800&h=1200&fit=crop', 'J.Crew', '$$', ARRAY['coastal', 'casual', 'relaxed'], 'casual', 'seed', false),
('Edgy Monochrome', 'All black everything. Maximum impact.', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&h=1200&fit=crop', 'AllSaints', '$$$', ARRAY['edgy', 'monochrome', 'bold'], 'streetwear', 'seed', true),
('Romantic Feminine', 'Soft textures and flowing silhouettes.', 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&h=1200&fit=crop', 'Reformation', '$$', ARRAY['romantic', 'feminine', 'soft'], 'feminine', 'seed', false),
('Retro 90s Revival', 'Nostalgic vibes with a fresh twist.', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&h=1200&fit=crop', 'Urban Outfitters', '$', ARRAY['retro', '90s', 'casual'], 'vintage', 'seed', true),
('Power Suit Era', 'Commanding presence, contemporary cut.', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&h=1200&fit=crop', 'Hugo Boss', '$$$$', ARRAY['power', 'professional', 'bold'], 'formal', 'seed', false),
('Cozy Scandinavian', 'Hygge-inspired simplicity and warmth.', 'https://images.unsplash.com/photo-1485968579169-a6e9f404ecf4?w=800&h=1200&fit=crop', 'COS', '$$', ARRAY['scandinavian', 'minimal', 'cozy'], 'casual', 'seed', true),
('Neon Nights', 'Cyber-inspired layers.', 'https://images.unsplash.com/photo-1550614000-4b9519e02a7d?w=800&h=1200&fit=crop', 'Acne Studios', '$$$', ARRAY['neon', 'night', 'bold'], 'streetwear', 'seed', false),
('Desert Nomad', 'Earth tones and flow.', 'https://images.unsplash.com/photo-1503341457453-bdb8944c4d52?w=800&h=1200&fit=crop', 'Isabel Marant', '$$$', ARRAY['nomad', 'earth', 'layered'], 'bohemian', 'seed', true),
('Techwear Shell', 'Weatherproof urban armor.', 'https://images.unsplash.com/photo-1542293787938-4d273c9c9f53?w=800&h=1200&fit=crop', 'Nike ACG', '$$$', ARRAY['techwear', 'urban', 'functional'], 'streetwear', 'seed', true),
('Quiet Luxury Knit', 'Soft handfeel, subtle logo.', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&h=1200&fit=crop', 'Loro Piana', '$$$$', ARRAY['quiet', 'luxury', 'knit'], 'casual', 'seed', false),
('Punk Plaid', 'Grunge energy rebooted.', 'https://images.unsplash.com/photo-1490114538077-0a7f8cb49891?w=800&h=1200&fit=crop', 'Vivienne Westwood', '$$$', ARRAY['punk', 'plaid', 'grunge'], 'vintage', 'seed', false),
('Y2K Shine', 'Metallic and playful.', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&h=1200&fit=crop', 'Blumarine', '$$', ARRAY['y2k', 'shine', 'playful'], 'feminine', 'seed', true),
('Outdoor Heritage', 'Gorpcore staples.', 'https://images.unsplash.com/photo-1551488852-0801751ac1f4?w=800&h=1200&fit=crop', 'Patagonia', '$$', ARRAY['outdoor', 'heritage', 'gorpcore'], 'athletic', 'seed', true),
('Parisian Chic', 'Effortless tailoring.', 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&h=1200&fit=crop', 'Sandro', '$$$', ARRAY['parisian', 'chic', 'tailored'], 'formal', 'seed', false),
('Art Hoe Palette', 'Museum-day colors.', 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&h=1200&fit=crop', 'Paloma Wool', '$$', ARRAY['art', 'color', 'creative'], 'casual', 'seed', false),
('Grunge Denim', 'Distressed classics.', 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=800&h=1200&fit=crop', 'Levi''s', '$', ARRAY['denim', 'grunge', 'classic'], 'casual', 'seed', true),
('Preppy Varsity', 'Campus codes.', 'https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?w=800&h=1200&fit=crop', 'Tommy Hilfiger', '$$', ARRAY['preppy', 'varsity', 'campus'], 'casual', 'seed', false),
('Gothic Romance', 'Dark florals.', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&h=1200&fit=crop', 'Rodarte', '$$$$', ARRAY['gothic', 'romance', 'dark'], 'feminine', 'seed', false),
('Utility Cargo', 'Pockets everywhere.', 'https://images.unsplash.com/photo-1516762689617-e1cffcef479d?w=800&h=1200&fit=crop', 'Carhartt WIP', '$$', ARRAY['utility', 'cargo', 'workwear'], 'streetwear', 'seed', true),
('Linen Resort', 'Vacation ease.', 'https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=800&h=1200&fit=crop', 'Massimo Dutti', '$$', ARRAY['linen', 'resort', 'relaxed'], 'casual', 'seed', false),
('Mod Sixties', 'Sharp silhouettes.', 'https://images.unsplash.com/photo-1539008835657-9e8e3770b6d4?w=800&h=1200&fit=crop', 'Saint Laurent', '$$$$', ARRAY['mod', '60s', 'sharp'], 'vintage', 'seed', true);

-- Taxonomy traits from community slugs / names
INSERT INTO public.community_taxonomy (community_id, trait, weight)
SELECT
  c.id,
  lower(trim(t.token)),
  1
FROM public.communities c
CROSS JOIN LATERAL unnest(
  string_to_array(replace(replace(c.slug, '-', ' '), '_', ' '), ' ')
  || string_to_array(c.name, ' ')
) AS t(token)
WHERE length(trim(t.token)) > 2
ON CONFLICT (community_id, trait) DO NOTHING;
