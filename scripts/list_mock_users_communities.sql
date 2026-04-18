-- Who is in which community (demo users from seed_mock_communities.sql).
-- Run in Supabase SQL after seeding.

SELECT
  u.email,
  p.display_name,
  c.slug AS community_slug,
  c.name AS community_name
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
JOIN public.community_members m ON m.user_id = u.id
JOIN public.communities c ON c.id = m.community_id
WHERE u.email LIKE '%.demo@phia.local'
ORDER BY u.email;
