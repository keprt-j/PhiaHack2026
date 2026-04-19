import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { candidateRowToOutfit, type CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"
import { logApi } from "@/lib/telemetry"
import { outfitCandidateStyleTags } from "@/lib/utils"

function mapCandidates(rows: unknown[] | null): Outfit[] {
  return (rows ?? []).map((r) => candidateRowToOutfit(r as CandidateRow))
}

function scoreRow(row: CandidateRow, userTagSet: Set<string>): number {
  const tags = (row.style_tags ?? []).map((t) => t.toLowerCase())
  let s = 0
  for (const t of tags) {
    if (userTagSet.has(t)) s += 3
  }
  if (row.source_url) s += 5
  if (row.source_type === "retail_scrape") s += 2
  if (row.source_type === "social_scrape") s += 1
  s += Math.min(row.likes_count ?? 0, 40) * 0.05
  if (row.is_trending) s += 0.5
  return s
}

function rankAndSlice(rows: CandidateRow[], userTagSet: Set<string>, limit: number): Outfit[] {
  const scored = [...rows].sort((a, b) => scoreRow(b, userTagSet) - scoreRow(a, userTagSet) || a.id.localeCompare(b.id))
  const seen = new Set<string>()
  const out: Outfit[] = []
  for (const row of scored) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(candidateRowToOutfit(row))
    if (out.length >= limit) break
  }
  return out
}

/**
 * GET /api/shop-picks — taste-matched catalog rows; prioritizes items with `source_url` (shop-able).
 * Query: `demo=1` — curated / trending picks (no personalization); public when RLS allows read.
 */
export async function GET(req: Request) {
  const started = Date.now()
  const { searchParams } = new URL(req.url)
  const demo = searchParams.get("demo") === "1"

  const supabase = await createClient()

  if (demo) {
    const { data: withLinks } = await supabase
      .from("outfit_candidates")
      .select("*")
      .not("source_url", "is", null)
      .order("likes_count", { ascending: false })
      .limit(36)

    if (withLinks?.length) {
      const genericTags = new Set<string>(["casual", "streetwear", "minimal", "classic"])
      logApi("/api/shop-picks", { ok: true, latencyMs: Date.now() - started, fallback: true })
      return NextResponse.json({
        outfits: rankAndSlice(withLinks as CandidateRow[], genericTags, 24),
        userTags: [] as string[],
        source: "demo_links",
      })
    }

    const { data: trending } = await supabase
      .from("outfit_candidates")
      .select("*")
      .eq("is_trending", true)
      .order("likes_count", { ascending: false })
      .limit(24)

    logApi("/api/shop-picks", { ok: true, latencyMs: Date.now() - started, fallback: true })
    return NextResponse.json({
      outfits: mapCandidates(trending),
      userTags: [] as string[],
      source: "demo_trending",
    })
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    logApi("/api/shop-picks", { ok: false, latencyMs: Date.now() - started, error: "unauthorized" })
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: usp } = await supabase
    .from("user_style_profiles")
    .select("preferred_brands, traits")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: profile } = await supabase.from("profiles").select("style_tags").eq("id", user.id).single()

  const tagSet = new Set<string>([
    ...((profile?.style_tags as string[] | null) ?? []).map((t: string) => t.toLowerCase()),
    ...((usp?.preferred_brands as string[]) ?? []).map((b) => b.toLowerCase()),
  ])

  const traits = (usp?.traits as Record<string, unknown> | null) ?? {}
  for (const k of Object.keys(traits)) {
    tagSet.add(k.toLowerCase())
  }

  const topTags = [...tagSet].filter(Boolean).slice(0, 16)

  let pool: CandidateRow[] = []

  if (topTags.length > 0) {
    const { data: overlap } = await supabase
      .from("outfit_candidates")
      .select("*")
      .overlaps("style_tags", topTags)
      .order("likes_count", { ascending: false })
      .limit(48)

    pool = (overlap ?? []) as CandidateRow[]
  }

  if (pool.length < 12) {
    const { data: swipes } = await supabase
      .from("swipes")
      .select("outfit_candidates ( style_tags )")
      .eq("user_id", user.id)
      .neq("direction", "left")

    const likedTags = swipes?.flatMap((s) => outfitCandidateStyleTags(s.outfit_candidates)) ?? []
    const tagCounts: Record<string, number> = {}
    likedTags.forEach((tag) => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1
    })
    const swipeTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag)

    for (const t of swipeTags) tagSet.add(t.toLowerCase())

    const mergedTags = [...tagSet].filter(Boolean).slice(0, 16)
    if (mergedTags.length) {
      const { data: more } = await supabase
        .from("outfit_candidates")
        .select("*")
        .overlaps("style_tags", mergedTags.length ? mergedTags : ["casual"])
        .order("likes_count", { ascending: false })
        .limit(48)

      const byId = new Map(pool.map((r) => [r.id, r]))
      for (const r of (more ?? []) as CandidateRow[]) {
        if (!byId.has(r.id)) byId.set(r.id, r)
      }
      pool = [...byId.values()]
    }
  }

  if (pool.length === 0) {
    const { data: fallback } = await supabase
      .from("outfit_candidates")
      .select("*")
      .eq("is_trending", true)
      .order("likes_count", { ascending: false })
      .limit(20)

    logApi("/api/shop-picks", { ok: true, latencyMs: Date.now() - started, fallback: true })
    return NextResponse.json({
      outfits: mapCandidates(fallback),
      userTags: topTags,
      source: "trending_fallback",
    })
  }

  const userTagSet = tagSet
  const outfits = rankAndSlice(pool, userTagSet, 24)

  logApi("/api/shop-picks", { ok: true, latencyMs: Date.now() - started })
  return NextResponse.json({
    outfits,
    userTags: [...userTagSet].slice(0, 12),
    source: "personalized",
  })
}
