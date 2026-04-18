-- Safe to run on existing DBs: prevents multiple open swipe_sessions per user (duplicate sessions → progress reset).
CREATE UNIQUE INDEX IF NOT EXISTS idx_swipe_sessions_one_open_user
  ON public.swipe_sessions (user_id)
  WHERE user_id IS NOT NULL AND completed_at IS NULL;
