import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logApi } from "@/lib/telemetry"
import { outfitCandidateStyleTags } from "@/lib/utils"

function matchedTagsForCommunity(
  community: { id: string; name: string; slug: string; description: string | null },
  userTokens: Set<string>,
  taxRows: { community_id: string; trait: string }[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of taxRows) {
    if (row.community_id !== community.id) continue
    const t = row.trait.toLowerCase()
    if (userTokens.has(t) && !seen.has(t)) {
      seen.add(t)
      out.push(row.trait)
    }
  }
  const blob = `${community.name} ${community.slug} ${community.description ?? ""}`.toLowerCase()
  for (const tok of userTokens) {
    if (tok.length < 2) continue
    if (blob.includes(tok) && !seen.has(tok)) {
      seen.add(tok)
      out.push(tok)
    }
  }
  return out.slice(0, 5)
}

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
      .limit(8)

    logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started, fallback: true })
    return NextResponse.json({ communities: communities ?? [], source: "popular" as const })
  }

  const [{ data: usp }, { data: profile }, { data: swipes }] = await Promise.all([
    supabase
      .from("user_style_profiles")
      .select("preferred_brands, traits, profile_prompt")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("style_tags").eq("id", user.id).maybeSingle(),
    supabase
      .from("swipes")
      .select("outfit_candidates ( style_tags )")
      .eq("user_id", user.id)
      .neq("direction", "left"),
  ])

  const likedTags = swipes?.flatMap((s) => outfitCandidateStyleTags(s.outfit_candidates)) ?? []

  const userTokens = new Set<string>()
  for (const t of profile?.style_tags ?? []) userTokens.add(t.toLowerCase().trim())
  for (const t of likedTags) userTokens.add(t.toLowerCase().trim())
  for (const b of (usp?.preferred_brands as string[]) ?? []) userTokens.add(b.toLowerCase())
  for (const k of Object.keys((usp?.traits as object) ?? {})) userTokens.add(k.toLowerCase())
  if (usp?.profile_prompt) {
    for (const w of usp.profile_prompt.toLowerCase().split(/\W+/)) {
      if (w.length > 3) userTokens.add(w)
    }
  }

  const { data: tax } = await supabase.from("community_taxonomy").select("community_id, trait, weight")
  const { data: allCommunities } = await supabase.from("communities").select("*")

  if (!allCommunities?.length) {
    logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({ communities: [], source: "empty" as const })
  }

  const taxList = tax ?? []

  if (userTokens.size) {
    const byComm = new Map<string, number>()
    for (const row of taxList) {
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
        /** Extra: hashtag ↔ swipe / profile tag overlap with slug tokens */
        const slugParts = community.slug.split(/[-_]/).filter((p: string) => p.length > 1)
        for (const part of slugParts) {
          if (userTokens.has(part.toLowerCase())) s += 1
        }
        const matched_tags = matchedTagsForCommunity(community, userTokens, taxList)
        return { ...community, matchScore: s, matched_tags }
      })
      .sort((a, b) => b.matchScore - a.matchScore || b.member_count - a.member_count)

    const top = scored.filter((c) => c.matchScore > 0).slice(0, 12)
    const payload = top.length ? top : scored.slice(0, 8)

    logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      communities: payload,
      source: top.length ? ("hashtags" as const) : ("popular_fallback" as const),
    })
  }

  /** No style tokens yet — rank by swipe keywords vs community names */
  const scoredCommunities = allCommunities
    .map((community) => {
      const communityName = `${community.name} ${community.slug} ${community.description ?? ""}`.toLowerCase()
      const matched = likedTags.filter(
        (tag) =>
          communityName.includes(tag.toLowerCase()) ||
          tag.toLowerCase().includes(community.slug.replace(/-/g, "")),
      )
      const matchScore = matched.length
      return {
        ...community,
        matchScore,
        matched_tags: [...new Set(matched.map((t) => t.toLowerCase()))].slice(0, 5),
      }
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.member_count - a.member_count)

  logApi("/api/communities/recommended", { ok: true, latencyMs: Date.now() - started, fallback: true })
  return NextResponse.json({
    communities: scoredCommunities.slice(0, 8),
    source: "swipe_match" as const,
  })
}
