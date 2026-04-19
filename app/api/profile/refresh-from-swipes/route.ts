import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  /** Kept for API compatibility; refresh always uses full history (see below). */
  uptoPosition: z.number().int().min(1).max(100).optional(),
})

/**
 * Natural, vibe-first copy — no swipe counts or "based on" framing.
 */
function buildProfilePrompt(prefer: string[], avoid: string[]): string {
  const top = prefer.slice(0, 8)
  const pass = avoid.slice(0, 5)

  if (!top.length) {
    return pass.length
      ? `You're still exploring. Lately you steer away from looks that lean too hard into ${pass.slice(0, 3).join(", ")}.`
      : "Your taste is still wide open—keep exploring silhouettes and palettes until a direction sticks."
  }

  const lead = top.slice(0, 4).join(", ")
  const tail =
    top.length > 4
      ? ` You keep circling back to ${top.slice(4, 7).join(", ")}${top.length > 7 ? ", and a few adjacent moods" : ""}.`
      : ""

  const avoidLine = pass.length
    ? ` What rarely lands: energy that goes too ${pass.slice(0, 3).join(" or ")}.`
    : ""

  return `You dress like someone who cares about ${lead}.${tail}${avoidLine}`.replace(/\s+/g, " ").trim()
}

function buildBio(prefer: string[]): string {
  if (!prefer.length) return "Exploring style directions."
  return `${prefer.slice(0, 4).join(" · ")} — a through-line in what you save.`
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = bodySchema.parse(await req.json())
    const admin = createServiceClient()

    const { data: sess } = await admin
      .from("swipe_sessions")
      .select("id, user_id")
      .eq("id", body.sessionId)
      .maybeSingle()
    if (!sess || sess.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    /** Every deck shares one memory pool: all swipe events across sessions (capped). */
    const { data: userSessions } = await admin.from("swipe_sessions").select("id").eq("user_id", user.id)

    const sessionIds = (userSessions ?? []).map((s) => s.id as string)
    if (!sessionIds.length) return NextResponse.json({ ok: true, updated: false })

    const { data: events } = await admin
      .from("swipe_events")
      .select("candidate_id, direction, position, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true })
      .limit(500)

    if (!events?.length) return NextResponse.json({ ok: true, updated: false })

    const candIds = [...new Set(events.map((e) => e.candidate_id as string))]
    const { data: cands } = await admin
      .from("outfit_candidates")
      .select("id, style_tags, brand_name")
      .in("id", candIds)
    const byId = new Map((cands ?? []).map((r) => [r.id as string, r]))

    const liked = new Map<string, number>()
    const disliked = new Map<string, number>()
    for (const ev of events) {
      const row = byId.get(ev.candidate_id as string)
      const tags = ((row?.style_tags as string[]) ?? []).map((t) => t.toLowerCase().trim())
      const brand = row?.brand_name ? [String(row.brand_name).toLowerCase()] : []
      const tokens = [...tags, ...brand].filter(Boolean)
      for (const tok of tokens) {
        const bucket = ev.direction === "left" ? disliked : liked
        bucket.set(tok, (bucket.get(tok) ?? 0) + 1)
      }
    }

    /** So a fresh session doesn’t erase summarize/onboarding tags before new likes stack up */
    const { data: prof } = await admin.from("profiles").select("style_tags").eq("id", user.id).maybeSingle()
    const savedTags = ((prof?.style_tags as string[]) ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean)
    for (const t of savedTags) {
      liked.set(t, (liked.get(t) ?? 0) + 1.25)
    }

    const prefer = [...liked.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k)
      .slice(0, 18)
    const avoid = [...disliked.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k)
      .filter((k) => !prefer.includes(k))
      .slice(0, 10)

    const profilePrompt = buildProfilePrompt(prefer, avoid)
    const bio = buildBio(prefer)
    const updatedAt = new Date().toISOString()

    await admin
      .from("profiles")
      .update({
        style_tags: prefer.slice(0, 12),
        bio,
        updated_at: updatedAt,
      })
      .eq("id", user.id)

    await admin.from("user_style_profiles").upsert({
      user_id: user.id,
      profile_prompt: profilePrompt,
      updated_at: updatedAt,
    })

    return NextResponse.json({ ok: true, updated: true, tags: prefer.slice(0, 12), profilePrompt })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
