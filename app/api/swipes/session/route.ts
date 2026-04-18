import { after, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { candidateRowToOutfit } from "@/lib/candidates/map-to-outfit"
import { pickNextCandidates, type SwipeSignal } from "@/lib/ranking/next-candidate"
import { loadCandidatePoolForSignals } from "@/lib/ranking/load-pool"
import { discoverKickOptsFromSignals, kickOffWebDiscover } from "@/lib/ranking/web-discover"
import { logApi } from "@/lib/telemetry"

const TARGET = 12

type StartBody = {
  sessionId?: string
  guestSessionId?: string
  reset?: boolean
  unlimited?: boolean
}

async function resumeIfActive(
  admin: ReturnType<typeof createServiceClient>,
  filter: { user_id?: string | null; guest_session_id?: string },
  preferredId?: string,
): Promise<string | null> {
  if (preferredId) {
    const { data } = await admin
      .from("swipe_sessions")
      .select("id, user_id, guest_session_id, completed_at")
      .eq("id", preferredId)
      .maybeSingle()
    if (
      data &&
      !data.completed_at &&
      ((filter.user_id !== undefined && data.user_id === filter.user_id) ||
        (filter.guest_session_id !== undefined && data.guest_session_id === filter.guest_session_id))
    ) {
      return data.id as string
    }
  }
  const q = admin.from("swipe_sessions").select("id").is("completed_at", null)
  const filtered =
    filter.user_id !== undefined ? q.eq("user_id", filter.user_id) : q.eq("guest_session_id", filter.guest_session_id ?? "")
  const { data } = await filtered.order("started_at", { ascending: false }).limit(1).maybeSingle()
  return data?.id ?? null
}

/**
 * Returns existing in-progress swipe session (so refresh keeps progress).
 * Pass `{ reset: true }` to force a brand-new session.
 */
export async function POST(req: Request) {
  const started = Date.now()
  try {
    const body = (await req.json().catch(() => ({}))) as StartBody

    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()

    const admin = createServiceClient()

    let sessionId: string
    let guestSessionId: string | null = null
    let resumed = false

    if (user?.id) {
      if (body.reset) {
        await admin
          .from("swipe_sessions")
          .update({ completed_at: new Date().toISOString() })
          .eq("user_id", user.id)
          .is("completed_at", null)
      }

      const existingId = body.reset
        ? null
        : await resumeIfActive(admin, { user_id: user.id }, body.sessionId)

      if (existingId) {
        const { data: existing } = await admin
          .from("swipe_sessions")
          .select("id, target_count")
          .eq("id", existingId)
          .maybeSingle()
        const currentTarget = typeof existing?.target_count === "number" ? existing.target_count : TARGET
        const wantsUnlimited = body.unlimited === true
        const existingUnlimited = currentTarget <= 0
        if (wantsUnlimited === existingUnlimited) {
          sessionId = existingId
          resumed = true
        } else {
          await admin
            .from("swipe_sessions")
            .update({ completed_at: new Date().toISOString() })
            .eq("id", existingId)
          const { data: inserted, error } = await admin
            .from("swipe_sessions")
            .insert({
              user_id: user.id,
              guest_session_id: null,
              target_count: wantsUnlimited ? 0 : TARGET,
            })
            .select("id")
            .single()
          if (error || !inserted) {
            console.error("[swipes/session]", error)
            logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "session" })
            return NextResponse.json({ error: "Could not start session" }, { status: 500 })
          }
          sessionId = inserted.id as string
        }
      } else {
        const { data: inserted, error } = await admin
          .from("swipe_sessions")
          .insert({
            user_id: user.id,
            guest_session_id: null,
            target_count: body.unlimited ? 0 : TARGET,
          })
          .select("id")
          .single()

        if (error?.code === "23505") {
          const raced = await resumeIfActive(admin, { user_id: user.id })
          if (raced) {
            sessionId = raced
            resumed = true
          } else {
            console.error("[swipes/session] unique but no row", error)
            logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "session" })
            return NextResponse.json({ error: "Could not start session" }, { status: 500 })
          }
        } else if (error || !inserted) {
          console.error("[swipes/session]", error)
          logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "session" })
          return NextResponse.json({ error: "Could not start session" }, { status: 500 })
        } else {
          sessionId = inserted.id as string
        }
      }
    } else {
      const requestedGuest = body.guestSessionId
      const existingId =
        !body.reset && requestedGuest
          ? await resumeIfActive(admin, { guest_session_id: requestedGuest }, body.sessionId)
          : null

      if (existingId && requestedGuest) {
        sessionId = existingId
        guestSessionId = requestedGuest
        resumed = true
      } else {
        if (body.reset && requestedGuest) {
          await admin
            .from("swipe_sessions")
            .update({ completed_at: new Date().toISOString() })
            .eq("guest_session_id", requestedGuest)
            .is("completed_at", null)
        }
        /**
         * One retry: if a passed-in guest id collides with a closed row (the unique index
         * isn't scoped to open sessions), mint a brand-new id and try again.
         */
        const insertGuest = async (gid: string) =>
          admin
            .from("swipe_sessions")
            .insert({ user_id: null, guest_session_id: gid, target_count: TARGET })
            .select("id")
            .single()

        let gid = requestedGuest && !body.reset ? requestedGuest : crypto.randomUUID()
        let { data: inserted, error } = await insertGuest(gid)
        if (error?.code === "23505") {
          gid = crypto.randomUUID()
          ;({ data: inserted, error } = await insertGuest(gid))
        }

        if (error || !inserted) {
          console.error("[swipes/session]", error)
          logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "session" })
          return NextResponse.json({ error: "Could not start session" }, { status: 500 })
        }
        sessionId = inserted.id as string
        guestSessionId = gid
      }
    }

    const { data: eventRows } = await admin
      .from("swipe_events")
      .select("candidate_id, direction")
      .eq("session_id", sessionId)
      .order("position", { ascending: true })

    const candIds = [...new Set((eventRows ?? []).map((e) => e.candidate_id as string))]
    const { data: candRows } =
      candIds.length > 0
        ? await admin.from("outfit_candidates").select("id, style_tags, brand_name").in("id", candIds)
        : { data: [] }

    const byId = new Map((candRows ?? []).map((r) => [r.id as string, r]))

    const signals: SwipeSignal[] =
      eventRows?.map((e) => {
        const row = byId.get(e.candidate_id as string)
        return {
          candidateId: e.candidate_id as string,
          direction: e.direction as SwipeSignal["direction"],
          tags: (row?.style_tags as string[]) ?? [],
          brand: (row?.brand_name as string | null) ?? null,
        }
      }) ?? []

    /**
     * Background Unsplash/web discover so `web_gemini` rows exist for post-intro picks (intro slots 1–3
     * never pick them). No swipe history on cold start — signal-guided kicks run from `/swipes/event`.
     */
    if (process.env.GEMINI_WEB_DISCOVER !== "0") {
      after(() => {
        void kickOffWebDiscover(admin, discoverKickOptsFromSignals(signals)).catch((e) =>
          console.warn("[swipes/session] web-discover", e),
        )
      })
    }

    const rows = await loadCandidatePoolForSignals(admin, signals)
    if (!rows.length) {
      logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "no_pool" })
      return NextResponse.json({ error: "No outfit candidates in database" }, { status: 500 })
    }

    let seen = new Set((eventRows ?? []).map((e) => e.candidate_id as string))
    let swipeCount = eventRows?.length ?? 0
    /** Next card in session order (1-based); intro rules apply only while this is ≤ 3. */
    let picked = pickNextCandidates(rows, seen, signals, 2, { upcomingSwipeStart: swipeCount + 1 })

    /**
     * Auto-recover: every visible row in this session has been swiped. Close the stale session
     * and start a fresh one for the same identity so the UI never deadlocks on an empty deck.
     * (Distinct from `reset:true` which is user-initiated.)
     */
    if (picked.length === 0 && (resumed || swipeCount > 0)) {
      await admin
        .from("swipe_sessions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", sessionId)

      /**
       * Always mint a fresh guest id on rollover. The unique index on `guest_session_id`
       * is NOT scoped to open sessions, so reusing a closed guest's id would 23505.
       * The client picks up the new id from the response and re-stores it.
       */
      const newGuestId = user?.id ? null : crypto.randomUUID()
      const { data: fresh, error: rollErr } = await admin
        .from("swipe_sessions")
        .insert({
          user_id: user?.id ?? null,
          guest_session_id: newGuestId,
          target_count: TARGET,
        })
        .select("id, guest_session_id")
        .single()

      if (!rollErr && fresh) {
        sessionId = fresh.id as string
        guestSessionId = (fresh.guest_session_id as string | null) ?? null
        resumed = false
        seen = new Set()
        swipeCount = 0
        picked = pickNextCandidates(rows, seen, [], 2, { upcomingSwipeStart: 1 })
        console.log("[swipes/session] rolled over exhausted session →", sessionId)
      } else {
        console.warn("[swipes/session] rollover failed", rollErr?.message)
      }
    }

    logApi("/api/swipes/session", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      sessionId,
      guestSessionId: user ? null : guestSessionId,
      targetCount: TARGET,
      resumed,
      swipeCount,
      cards: picked.map((r) => candidateRowToOutfit(r)),
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
