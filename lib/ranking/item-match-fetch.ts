import type { createServiceClient } from "@/lib/supabase/admin"
import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import { tokenizeItemQuery } from "@/lib/ranking/item-query"

type Admin = ReturnType<typeof createServiceClient>

function safeTok(t: string): string | null {
  const s = t.toLowerCase().replace(/[^a-z0-9-]/g, "")
  return s.length >= 2 ? s : null
}

/**
 * Per-token title/description ILIKE; intersect IDs so every token appears somewhere.
 * Fallback when `match_outfit_candidates_by_item_query` RPC is not installed.
 */
async function fetchByTokenIntersection(admin: Admin, tokens: string[]): Promise<Set<string>> {
  if (!tokens.length) return new Set()
  let acc: Set<string> | null = null
  for (const t of tokens) {
    const pat = `%${t}%`
    const { data, error } = await admin
      .from("outfit_candidates")
      .select("id")
      .or(`title.ilike.${pat},description.ilike.${pat}`)
      .limit(500)
    if (error) {
      console.warn("[item-match-fetch] ilike token", t, error.message)
      continue
    }
    const next = new Set((data ?? []).map((r) => r.id as string))
    acc = acc === null ? next : new Set<string>([...acc].filter((id: string) => next.has(id)))
  }
  return acc ?? new Set()
}

/** Any token matches (widening when AND intersection is empty). */
async function fetchByTokenUnion(admin: Admin, tokens: string[], cap: number): Promise<Set<string>> {
  const union = new Set<string>()
  for (const t of tokens) {
    if (union.size >= cap) break
    const pat = `%${t}%`
    const { data, error } = await admin
      .from("outfit_candidates")
      .select("id")
      .or(`title.ilike.${pat},description.ilike.${pat}`)
      .limit(500)
    if (error) continue
    for (const r of data ?? []) {
      union.add(r.id as string)
      if (union.size >= cap) break
    }
  }
  return union
}

/**
 * Prefer catalog rows that literally contain every search token in searchable text (RPC when present).
 * Reuses existing `outfit_candidates` before ranking / web_gemini dilution.
 */
export async function fetchItemQueryMatchedCandidates(
  admin: Admin,
  rawQuery: string,
): Promise<{ rows: CandidateRow[]; matchedIds: Set<string> }> {
  const q = rawQuery.trim()
  if (!q) return { rows: [], matchedIds: new Set() }

  const { data: rpcRows, error: rpcErr } = await admin.rpc("match_outfit_candidates_by_item_query", {
    search_q: q,
    result_limit: 450,
  })

  if (!rpcErr && rpcRows && Array.isArray(rpcRows) && rpcRows.length > 0) {
    const rows = rpcRows as CandidateRow[]
    return { rows, matchedIds: new Set(rows.map((r) => r.id)) }
  }
  if (rpcErr) {
    console.warn("[item-match-fetch] RPC (using title/description fallback)", rpcErr.message)
  }

  const tokens = tokenizeItemQuery(q).map(safeTok).filter(Boolean) as string[]
  if (!tokens.length) return { rows: [], matchedIds: new Set() }

  let ids = await fetchByTokenIntersection(admin, tokens)
  if (ids.size === 0) {
    ids = await fetchByTokenUnion(admin, tokens, 500)
  }
  if (ids.size === 0) return { rows: [], matchedIds: new Set() }

  const idList = [...ids].slice(0, 450)
  const { data: rows, error } = await admin.from("outfit_candidates").select("*").in("id", idList)
  if (error) {
    console.warn("[item-match-fetch] fetch by ids", error.message)
    return { rows: [], matchedIds: new Set() }
  }
  const list = (rows ?? []) as CandidateRow[]
  return { rows: list, matchedIds: new Set(list.map((r) => r.id)) }
}
