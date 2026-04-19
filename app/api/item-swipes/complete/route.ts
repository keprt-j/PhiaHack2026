import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { logApi } from "@/lib/telemetry"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
})

/**
 * End an item swipe session early (Done button) before the last card.
 */
export async function POST(req: Request) {
  const started = Date.now()
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = bodySchema.parse(await req.json())
    const admin = createServiceClient()

    const { data: sess, error } = await admin
      .from("swipe_sessions")
      .select("id, user_id, item_search_query, completed_at")
      .eq("id", body.sessionId)
      .maybeSingle()

    if (error || !sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    if (sess.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!sess.item_search_query) {
      return NextResponse.json({ error: "Not an item search session" }, { status: 400 })
    }
    if (sess.completed_at) {
      logApi("/api/item-swipes/complete", { ok: true, latencyMs: Date.now() - started })
      return NextResponse.json({ ok: true, alreadyComplete: true })
    }

    await admin
      .from("swipe_sessions")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", body.sessionId)

    logApi("/api/item-swipes/complete", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/item-swipes/complete", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
