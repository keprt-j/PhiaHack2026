import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { synthesizeStyleProfileStage2 } from "@/lib/ai/gemini"
import type { Community, Post } from "@/lib/types"
import { logApi } from "@/lib/telemetry"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  guestSessionId: z.string().uuid().optional(),
})

async function assertSessionAccess(
  admin: ReturnType<typeof createServiceClient>,
  sessionId: string,
  userId: string | null,
  guestSessionId: string | undefined,
) {
  const { data: sess, error } = await admin
    .from("swipe_sessions")
    .select("id, user_id, guest_session_id")
    .eq("id", sessionId)
    .single()

  if (error || !sess) return { ok: false as const, status: 404 as const }

  if (sess.user_id) {
    if (!userId || sess.user_id !== userId) return { ok: false as const, status: 403 as const }
    return { ok: true as const, sess }
  }

  if (!guestSessionId || sess.guest_session_id !== guestSessionId) {
    return { ok: false as const, status: 403 as const }
  }
  return { ok: true as const, sess }
}

function scoreCommunities(
  communities: { id: string; name: string; slug: string; member_count: number; description: string | null; icon_url: string | null; cover_url: string | null; created_at: string }[],
  taxonomy: { community_id: string; trait: string; weight: number }[],
  userTokens: Set<string>,
): (Community & { matchScore: number })[] {
  const byComm = new Map<string, number>()
  for (const row of taxonomy) {
    const t = row.trait.toLowerCase()
    if (!userTokens.has(t)) continue
    byComm.set(row.community_id, (byComm.get(row.community_id) ?? 0) + row.weight)
  }

  return communities
    .map((c) => {
      let s = byComm.get(c.id) ?? 0
      const blob = `${c.name} ${c.slug} ${c.description ?? ""}`.toLowerCase()
      for (const tok of userTokens) {
        if (tok.length > 2 && blob.includes(tok)) s += 0.5
      }
      return { ...c, matchScore: s }
    })
    .sort((a, b) => b.matchScore - a.matchScore || b.member_count - a.member_count)
}

function scorePosts(posts: Post[], userTokens: Set<string>): Post[] {
  return [...posts].sort((a, b) => {
    const as = a.outfit_tags.filter((t) => userTokens.has(t.toLowerCase())).length
    const bs = b.outfit_tags.filter((t) => userTokens.has(t.toLowerCase())).length
    return bs - as || b.upvotes - a.upvotes
  })
}

export async function POST(req: Request) {
  const started = Date.now()
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()

    const json = await req.json()
    const body = bodySchema.parse(json)

    const admin = createServiceClient()
    const access = await assertSessionAccess(
      admin,
      body.sessionId,
      user?.id ?? null,
      body.guestSessionId,
    )
    if (!access.ok) {
      logApi("/api/profile/summarize", { ok: false, latencyMs: Date.now() - started, error: "forbidden" })
      return NextResponse.json({ error: "Forbidden" }, { status: access.status })
    }

    const { data: sessExtra } = await admin
      .from("swipe_sessions")
      .select("reddit_profile_seed, style_guidance")
      .eq("id", body.sessionId)
      .single()

    const { data: events } = await admin
      .from("swipe_events")
      .select("candidate_id, direction, position")
      .eq("session_id", body.sessionId)
      .order("position", { ascending: true })

    if (!events?.length) {
      logApi("/api/profile/summarize", { ok: false, latencyMs: Date.now() - started, error: "no_events" })
      return NextResponse.json({ error: "No swipes for session" }, { status: 400 })
    }

    const ids = events.map((e) => e.candidate_id as string)
    const { data: cands } = await admin
      .from("outfit_candidates")
      .select("id, title, brand_name, style_tags")
      .in("id", ids)

    const byId = new Map((cands ?? []).map((r) => [r.id as string, r]))

    const lines: string[] = []
    const likedTags = new Set<string>()
    for (const ev of events) {
      const c = byId.get(ev.candidate_id as string)
      const tags = (c?.style_tags as string[])?.join(", ") ?? ""
      const brand = (c?.brand_name as string) ?? "unknown brand"
      const title = (c?.title as string) ?? "look"
      lines.push(
        `pos ${ev.position}: ${ev.direction} — ${title} (${brand}) tags: [${tags}]`,
      )
      if (ev.direction !== "left") {
        for (const t of (c?.style_tags as string[]) ?? []) {
          likedTags.add(t.toLowerCase())
        }
        if (c?.brand_name) likedTags.add(String(c.brand_name).toLowerCase())
      }
    }

    const swipeSummary = lines.join("\n")
    const redditSeed =
      typeof sessExtra?.reddit_profile_seed === "string" && sessExtra.reddit_profile_seed.trim()
        ? sessExtra.reddit_profile_seed.trim()
        : null
    const swipeSummaryForModel =
      redditSeed != null
        ? `${swipeSummary}\n\nExploration brief (for community / Reddit-style matching):\n${redditSeed}`
        : swipeSummary

    const profile = await synthesizeStyleProfileStage2({ swipeSummary: swipeSummaryForModel })

    for (const b of profile.preferred_brands) {
      likedTags.add(b.toLowerCase())
    }

    const userTokens = new Set(likedTags)
    for (const k of Object.keys(profile.traits)) {
      userTokens.add(k.toLowerCase())
    }

    const [{ data: communities }, { data: tax }, { data: posts }] = await Promise.all([
      admin.from("communities").select("*"),
      admin.from("community_taxonomy").select("community_id, trait, weight"),
      admin
        .from("posts")
        .select(
          `
          *,
          profiles:user_id (id, display_name, avatar_url),
          communities:community_id (id, name, slug)
        `,
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ])

    const ranked = scoreCommunities(
      (communities ?? []) as Parameters<typeof scoreCommunities>[0],
      (tax ?? []) as Parameters<typeof scoreCommunities>[1],
      userTokens,
    ).slice(0, 8)

    const rankedCommunities = ranked.map(({ matchScore: _m, ...c }) => c)

    const rankedPosts = scorePosts((posts ?? []) as Post[], userTokens).slice(0, 30)

    const payload = {
      profile,
      profileTags: [...userTokens].slice(0, 24),
      recommendedCommunities: rankedCommunities,
      initialFeedPosts: rankedPosts,
      source: profile.confidence >= 0.65 ? "gemini" : "fallback_or_low_confidence",
      latencyMs: Date.now() - started,
    }

    logApi("/api/profile/summarize", {
      ok: true,
      latencyMs: Date.now() - started,
      fallback: profile.confidence < 0.65,
    })

    await admin
      .from("swipe_sessions")
      .update({ synthesis_result: payload as unknown as Record<string, unknown> })
      .eq("id", body.sessionId)

    if (user?.id) {
      await admin.from("user_style_profiles").upsert({
        user_id: user.id,
        traits: profile.traits as Record<string, unknown>,
        preferred_brands: profile.preferred_brands,
        disliked_brands: profile.disliked_brands,
        profile_prompt: profile.profile_prompt,
        classifier_snapshot: {
          swipeSummary,
          reddit_profile_seed: redditSeed,
          style_guidance: sessExtra?.style_guidance ?? null,
        },
        confidence: profile.confidence,
        updated_at: new Date().toISOString(),
      })

      await admin
        .from("profiles")
        .update({
          style_tags: [...userTokens].slice(0, 12),
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
    }

    return NextResponse.json(payload)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("[profile/summarize]", e)
    logApi("/api/profile/summarize", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
