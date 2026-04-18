import { createServiceClient } from "@/lib/supabase/admin"
import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { StylePickGuidance, SwipeSignal } from "@/lib/ranking/next-candidate"

type Admin = ReturnType<typeof createServiceClient>

/** Rows from Gemini + Google Search — must stay in the mix even when tag-narrowing matches many seed cards. */
async function fetchWebGeminiCandidates(admin: Admin, limit: number): Promise<CandidateRow[]> {
  const { data, error } = await admin
    .from("outfit_candidates")
    .select("*")
    .eq("source_type", "web_gemini")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.warn("[load-pool] web_gemini", error.message)
    return []
  }
  return (data ?? []) as CandidateRow[]
}

/** Prefer web-discovered cards first so `pickNextCandidates` can surface them under shuffle + scoring. */
function mergeWebGeminiIntoPool(web: CandidateRow[], base: CandidateRow[]): CandidateRow[] {
  if (!web.length) return base
  const seen = new Set<string>()
  const out: CandidateRow[] = []
  for (const c of web) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  for (const c of base) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

/**
 * Single broad pool — tag-narrowing used to shrink the deck until nothing unseen was left,
 * which produced empty `nextCard` and sent the UI back to “preparing your deck”.
 */
export async function loadCandidatePoolForSignals(
  admin: Admin,
  _signals: SwipeSignal[],
  _opts?: { deckPosition?: number; guidance?: StylePickGuidance | null },
): Promise<CandidateRow[]> {
  const web = await fetchWebGeminiCandidates(admin, 80)

  const { data: pool, error: pErr } = await admin
    .from("outfit_candidates")
    .select("*")
    .order("freshness_score", { ascending: false })
    .limit(200)

  if (pErr) return mergeWebGeminiIntoPool(web, [])
  return mergeWebGeminiIntoPool(web, (pool ?? []) as CandidateRow[])
}
