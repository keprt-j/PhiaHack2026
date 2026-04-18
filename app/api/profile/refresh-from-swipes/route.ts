import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  uptoPosition: z.number().int().min(1).max(100).optional(),
})

function buildPrompt(prefer: string[], avoid: string[], swipeCount: number): string {
  const likePart = prefer.length
    ? `Leans toward: ${prefer.slice(0, 10).join(", ")}.`
    : "Leans toward versatile, mixed-style outfits."
  const avoidPart = avoid.length ? ` Usually skips: ${avoid.slice(0, 6).join(", ")}.` : ""
  return `Adaptive style profile after ${swipeCount} swipes. ${likePart}${avoidPart}`
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

    const eventsQuery = admin
      .from("swipe_events")
      .select("candidate_id, direction, position")
      .eq("session_id", body.sessionId)
      .order("position", { ascending: true })
      .limit(80)
    const { data: events } = body.uptoPosition
      ? await eventsQuery.lte("position", body.uptoPosition)
      : await eventsQuery

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
      const tags = ((row?.style_tags as string[]) ?? []).map((t) => t.toLowerCase())
      const brand = row?.brand_name ? [String(row.brand_name).toLowerCase()] : []
      const tokens = [...tags, ...brand]
      for (const tok of tokens) {
        if (!tok) continue
        const bucket = ev.direction === "left" ? disliked : liked
        bucket.set(tok, (bucket.get(tok) ?? 0) + 1)
      }
    }

    const prefer = [...liked.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k)
      .slice(0, 12)
    const avoid = [...disliked.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k)
      .filter((k) => !prefer.includes(k))
      .slice(0, 8)

    const swipeCount = events.length
    const profilePrompt = buildPrompt(prefer, avoid, swipeCount)
    const bio = `Current style direction: ${prefer.slice(0, 5).join(", ") || "evolving mix"}`
    const updatedAt = new Date().toISOString()

    await admin
      .from("profiles")
      .update({
        style_tags: prefer,
        bio,
        updated_at: updatedAt,
      })
      .eq("id", user.id)

    await admin.from("user_style_profiles").upsert({
      user_id: user.id,
      profile_prompt: profilePrompt,
      updated_at: updatedAt,
    })

    return NextResponse.json({ ok: true, updated: true, tags: prefer, profilePrompt })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
