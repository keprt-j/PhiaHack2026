-- Lets PostgREST embed `profiles:user_id` on posts (profiles.id = auth user id).
-- Safe if every post author has a profile row (your trigger creates one on signup).

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_user_id_fkey;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE;
