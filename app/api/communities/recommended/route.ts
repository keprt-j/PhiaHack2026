import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logApi } from "@/lib/telemetry"
import { outfitCandidateStyleTags } from "@/lib/utils"

export async function GET() {
  const started = Date.now()
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const { data: communities } = await supabase
      .from("communities")
      .select("*")
      .order("member_count", { ascending: false })
      .limit(5)

    logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started, fallback: true })
    return NextResponse.json({ communities, source: "popular" })
  }

  const { data: usp } = await supabase
    .from("user_style_profiles")
    .select("preferred_brands, traits, profile_prompt")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: profile } = await supabase
    .from("profiles")
    .select("style_tags")
    .eq("id", user.id)
    .single()

  const userTokens = new Set<string>()
  for (const t of profile?.style_tags ?? []) userTokens.add(t.toLowerCase())
  for (const b of (usp?.preferred_brands as string[]) ?? []) userTokens.add(b.toLowerCase())
  for (const k of Object.keys((usp?.traits as object) ?? {})) userTokens.add(k.toLowerCase())
  if (usp?.profile_prompt) {
    for (const w of usp.profile_prompt.toLowerCase().split(/\W+/)) {
      if (w.length > 3) userTokens.add(w)
    }
  }

  const { data: tax } = await supabase.from("community_taxonomy").select("community_id, trait, weight")

  const { data: allCommunities } = await supabase.from("communities").select("*")

  if (userTokens.size && tax?.length && allCommunities?.length) {
    const byComm = new Map<string, number>()
    for (const row of tax) {
      const t = row.trait.toLowerCase()
      if (!userTokens.has(t)) continue
      byComm.set(row.community_id, (byComm.get(row.community_id) ?? 0) + (row.weight as number))
    }

    const scored = allCommunities
      .map((community) => {
        let s = byComm.get(community.id) ?? 0
        const blob = `${community.name} ${community.slug} ${community.description ?? ""}`.toLowerCase()
        for (const tok of userTokens) {
          if (tok.length > 2 && blob.includes(tok)) s += 0.5
        }
        return { ...community, matchScore: s }
      })
      .sort((a, b) => b.matchScore - a.matchScore || b.member_count - a.member_count)

    logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      communities: scored.slice(0, 8),
      source: "taxonomy",
    })
  }

  const { data: swipes } = await supabase
    .from("swipes")
    .select("outfit_candidates ( style_tags )")
    .eq("user_id", user.id)
    .neq("direction", "left")

  const likedTags = swipes?.flatMap((s) => outfitCandidateStyleTags(s.outfit_candidates)) ?? []

  const scoredCommunities = (allCommunities ?? [])
    .map((community) => {
      const communityName = community.name.toLowerCase()
      const matchScore = likedTags.filter(
        (tag) =>
          communityName.includes(tag.toLowerCase()) || tag.toLowerCase().includes(community.slug),
      ).length

      return { ...community, matchScore }
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.member_count - a.member_count)

  logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started, fallback: true })
  return NextResponse.json({
    communities: scoredCommunities?.slice(0, 5),
    source: "swipe_match",
  })
}
