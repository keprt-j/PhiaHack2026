import { createClient } from "@supabase/supabase-js"

/** Server-only client with service role (bypasses RLS). Use for guest swipe flows and ingest. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
  }
  return createClient(url, key)
}
