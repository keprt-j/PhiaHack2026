-- Run in Supabase SQL editor if mock post authors show email-like handles instead of names.
-- Sets display_name + Reddit-style username for *.demo@phia.local users.

UPDATE public.profiles p
SET
  display_name = v.display_name,
  username = v.username,
  updated_at = now()
FROM auth.users u
JOIN (
  VALUES
    ('ari.lane.demo@phia.local', 'Ari Lane', 'ari_lane'),
    ('mina.park.demo@phia.local', 'Mina Park', 'mina_park'),
    ('diego.vale.demo@phia.local', 'Diego Vale', 'diego_vale'),
    ('skye.rowan.demo@phia.local', 'Skye Rowan', 'skye_rowan'),
    ('nia.shore.demo@phia.local', 'Nia Shore', 'nia_shore'),
    ('theo.finch.demo@phia.local', 'Theo Finch', 'theo_finch'),
    ('soren.vale.demo@phia.local', 'Soren Vale', 'soren_vale'),
    ('lila.moss.demo@phia.local', 'Lila Moss', 'lila_moss'),
    ('kade.nyx.demo@phia.local', 'Kade Nyx', 'kade_nyx'),
    ('jules.hart.demo@phia.local', 'Jules Hart', 'jules_hart')
) AS v(email, display_name, username) ON lower(u.email) = lower(v.email)
WHERE p.id = u.id;
