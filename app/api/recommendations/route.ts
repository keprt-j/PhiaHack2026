import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { candidateRowToOutfit, type CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"
import { logApi } from "@/lib/telemetry"
import { outfitCandidateStyleTags } from "@/lib/utils"

function mapCandidates(rows: unknown[] | null): Outfit[] {
  return (rows ?? []).map((r) => candidateRowToOutfit(r as CandidateRow))
}

export async function GET() {
  const started = Date.now()
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const { data: rows } = await supabase
      .from("outfit_candidates")
      .select("*")
      .eq("is_trending", true)
      .order("likes_count", { ascending: false })
      .limit(10)

    logApi("/api/recommendations", { ok: true, latencyMs: Date.now() - started, fallback: true })
    return NextResponse.json({ outfits: mapCandidates(rows), source: "trending" })
  }

  const { data: usp } = await supabase
    .from("user_style_profiles")
    .select("preferred_brands, traits")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: profile } = await supabase
    .from("profiles")
    .select("style_tags")
    .eq("id", user.id)
    .single()

  const tagSet = new Set<string>([
    ...(profile?.style_tags ?? []),
    ...((usp?.preferred_brands as string[]) ?? []).map((b) => b.toLowerCase()),
  ])

  const traits = (usp?.traits as Record<string, unknown> | null) ?? {}
  for (const k of Object.keys(traits)) {
    tagSet.add(k.toLowerCase())
  }

  const topTags = [...tagSet].filter(Boolean).slice(0, 12)

  if (topTags.length > 0) {
    const { data: rows } = await supabase
      .from("outfit_candidates")
      .select("*")
      .overlaps("style_tags", topTags)
      .order("likes_count", { ascending: false })
      .limit(25)

    if (rows?.length) {
      logApi("/api/recommendations", { ok: true, latencyMs: Date.now() - started })
      return NextResponse.json({
        outfits: mapCandidates(rows),
        userTags: topTags,
        source: "profile",
      })
    }
  }

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
    .slice(0, 5)
    .map(([tag]) => tag)

  const { data: rows } = await supabase
    .from("outfit_candidates")
    .select("*")
    .overlaps("style_tags", swipeTags.length ? swipeTags : ["casual"])
    .order("likes_count", { ascending: false })
    .limit(20)

  logApi("/api/recommendations", { ok: true, latencyMs: Date.now() - started, fallback: true })
  return NextResponse.json({
    outfits: mapCandidates(rows),
    userTags: swipeTags,
    source: "swipe_tags",
  })
}
