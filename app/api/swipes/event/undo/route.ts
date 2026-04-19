import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
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
    .select("id, user_id, guest_session_id, target_count, completed_at")
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

export async function POST(req: Request) {
  const started = Date.now()
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()

    const body = bodySchema.parse(await req.json())
    const admin = createServiceClient()
    const access = await assertSessionAccess(
      admin,
      body.sessionId,
      user?.id ?? null,
      body.guestSessionId,
    )
    if (!access.ok) {
      logApi("/api/swipes/event/undo", { ok: false, latencyMs: Date.now() - started, error: "forbidden" })
      return NextResponse.json({ error: "Forbidden" }, { status: access.status })
    }

    const { data: lastRow } = await admin
      .from("swipe_events")
      .select("position")
      .eq("session_id", body.sessionId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastRow?.position) {
      logApi("/api/swipes/event/undo", { ok: false, latencyMs: Date.now() - started, error: "empty" })
      return NextResponse.json({ error: "Nothing to undo" }, { status: 400 })
    }

    const lastPos = lastRow.position as number

    const { error: delErr } = await admin
      .from("swipe_events")
      .delete()
      .eq("session_id", body.sessionId)
      .eq("position", lastPos)

    if (delErr) {
      console.error("[swipes/event/undo] delete", delErr)
      logApi("/api/swipes/event/undo", { ok: false, latencyMs: Date.now() - started, error: delErr.message })
      return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    const targetCount = Number(access.sess.target_count ?? 12)
    const isUnlimited = targetCount <= 0

    /** Re-open a session that had just been marked complete (last swipe was the final one). */
    if (!isUnlimited && lastPos >= targetCount && access.sess.completed_at) {
      await admin.from("swipe_sessions").update({ completed_at: null }).eq("id", body.sessionId)
    }

    const swipeCount = lastPos - 1
    logApi("/api/swipes/event/undo", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      ok: true,
      swipeCount,
      undonePosition: lastPos,
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/swipes/event/undo", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
