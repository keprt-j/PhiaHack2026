import { createServiceClient } from "@/lib/supabase/admin"
import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { StylePickGuidance, SwipeSignal } from "@/lib/ranking/next-candidate"
import { fetchItemQueryMatchedCandidates } from "@/lib/ranking/item-match-fetch"
import { scoreCandidateForItemQuery, tokenizeItemQuery } from "@/lib/ranking/item-query"

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
  const web = await fetchWebGeminiCandidates(admin, 48)

  const { data: pool, error: pErr } = await admin
    .from("outfit_candidates")
    .select("*")
    .order("freshness_score", { ascending: false })
    .limit(160)

  if (pErr) return mergeWebGeminiIntoPool(web, [])
  return mergeWebGeminiIntoPool(web, (pool ?? []) as CandidateRow[])
}

export type RankedItemDeck = {
  rows: CandidateRow[]
  /** Stable preference order for this search — stored on `swipe_sessions.item_deck_order`. */
  orderedIds: string[]
}

/**
 * One-time ranked list for an item query (e.g. "white dress shirt"). Kept small for latency.
 */
export async function rankItemDeck(admin: Admin, rawQuery: string): Promise<RankedItemDeck> {
  const tokens = tokenizeItemQuery(rawQuery)
  if (tokens.length === 0) {
    const rows = await loadCandidatePoolForSignals(admin, [])
    return { rows, orderedIds: rows.map((r) => r.id) }
  }

  /** Rows that already contain every query token in DB text — prefer these over random trending / web. */
  const { rows: tokenMatchedRows, matchedIds } = await fetchItemQueryMatchedCandidates(admin, rawQuery)

  const webLimit = tokenMatchedRows.length >= 28 ? 14 : 36
  const web = await fetchWebGeminiCandidates(admin, webLimit)

  const { data: pool, error: pErr } = await admin
    .from("outfit_candidates")
    .select("*")
    .order("freshness_score", { ascending: false })
    .limit(520)

  if (pErr) {
    console.warn("[load-pool] item query base", pErr.message)
  }

  const base = (pool ?? []) as CandidateRow[]
  const mergedMap = new Map<string, CandidateRow>()
  const mergeOrder: string[] = []
  const push = (r: CandidateRow) => {
    if (!mergedMap.has(r.id)) {
      mergedMap.set(r.id, r)
      mergeOrder.push(r.id)
    }
  }
  for (const r of tokenMatchedRows) push(r)
  for (const r of base) push(r)
  for (const r of web) push(r)

  const merged = mergeOrder.map((id) => mergedMap.get(id)!).filter(Boolean)

  const scored = merged
    .map((row) => ({
      row,
      score:
        scoreCandidateForItemQuery(row, rawQuery) +
        (matchedIds.has(row.id) ? 12 : 0) +
        (matchedIds.has(row.id) && row.source_type !== "web_gemini" ? 6 : 0),
    }))
    .sort((a, b) => {
      const ds = b.score - a.score
      if (ds !== 0) return ds
      const am = matchedIds.has(a.row.id) ? 1 : 0
      const bm = matchedIds.has(b.row.id) ? 1 : 0
      if (bm !== am) return bm - am
      const aw = a.row.source_type === "web_gemini" ? 0 : 1
      const bw = b.row.source_type === "web_gemini" ? 0 : 1
      if (bw !== aw) return bw - aw
      return (b.row.likes_count ?? 0) - (a.row.likes_count ?? 0)
    })

  const positive = scored.filter((x) => x.score > 0)
  const topScore = positive[0]?.score ?? 0

  let chosen: typeof scored
  if (positive.length >= 8 && topScore >= 8) {
    const floor = Math.max(6, topScore * 0.32)
    chosen = positive.filter((x) => x.score >= floor)
    if (chosen.length < 8) chosen = positive.slice(0, 120)
  } else if (positive.length > 0) {
    chosen = positive
  } else {
    /** No overlap with query — do not pad with unrelated trending rows; web-discover may add better cards next. */
    chosen = []
  }

  const picked = chosen.slice(0, 160).map((x) => x.row)

  const seen = new Set<string>()
  const dedup: CandidateRow[] = []
  for (const r of picked) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    dedup.push(r)
  }

  const orderedIds = dedup.map((r) => r.id)
  return { rows: dedup, orderedIds }
}

/**
 * Hydrate ranked rows for the next pick using the frozen id list (fast path per swipe).
 */
export async function fetchItemDeckRowsOrdered(
  admin: Admin,
  orderedIds: string[],
  seen: Set<string>,
): Promise<CandidateRow[]> {
  const unseen = orderedIds.filter((id) => !seen.has(id))
  if (!unseen.length) return []
  const chunk = unseen.slice(0, 100)
  const { data, error } = await admin.from("outfit_candidates").select("*").in("id", chunk)
  if (error) {
    console.warn("[load-pool] fetchItemDeckRowsOrdered", error.message)
    return []
  }
  const byId = new Map((data ?? []).map((r) => [r.id as string, r as CandidateRow]))
  return chunk.map((id) => byId.get(id)).filter(Boolean) as CandidateRow[]
}

/**
 * Deck for item-first swiping — builds ranked list (prefer `rankItemDeck` + DB `item_deck_order` in API).
 */
export async function loadCandidatePoolForItemQuery(admin: Admin, rawQuery: string): Promise<CandidateRow[]> {
  const { rows } = await rankItemDeck(admin, rawQuery)
  return rows
}
