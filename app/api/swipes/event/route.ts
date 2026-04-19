import { after, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { candidateRowToOutfit, type CandidateRow } from "@/lib/candidates/map-to-outfit"
import {
  parseStylePickGuidance,
  pickNextCandidates,
  type SwipeSignal,
} from "@/lib/ranking/next-candidate"
import {
  fetchItemDeckRowsOrdered,
  loadCandidatePoolForSignals,
  rankItemDeck,
} from "@/lib/ranking/load-pool"
import { discoverKickOptsFromSignals, kickOffWebDiscover } from "@/lib/ranking/web-discover"
import { runStyleIntroPhase, runStyleRefinePhase } from "@/lib/style-profile/style-phase"
import { logApi } from "@/lib/telemetry"

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  direction: z.enum(["left", "right", "super"]),
  position: z.number().int().min(1).max(100),
  guestSessionId: z.string().uuid().optional(),
  dwellMs: z.number().optional(),
  excludeCandidateIds: z.array(z.string().uuid()).optional(),
})

async function assertSessionAccess(
  admin: ReturnType<typeof createServiceClient>,
  sessionId: string,
  userId: string | null,
  guestSessionId: string | undefined,
) {
  const { data: sess, error } = await admin
    .from("swipe_sessions")
    .select("id, user_id, guest_session_id, target_count, item_search_query, item_deck_order")
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
      logApi("/api/swipes/event", { ok: false, latencyMs: Date.now() - started, error: "forbidden" })
      return NextResponse.json({ error: "Forbidden" }, { status: access.status })
    }

    const { error: evErr } = await admin.from("swipe_events").insert({
      session_id: body.sessionId,
      candidate_id: body.candidateId,
      direction: body.direction,
      position: body.position,
      dwell_ms: body.dwellMs ?? null,
    })

    /** Same swipe submitted twice (double-tap / retry) — row already exists; continue so Gemini hooks still run. */
    const duplicateSwipe = evErr?.code === "23505"
    if (evErr && !duplicateSwipe) {
      console.error("[swipes/event] insert", evErr)
      logApi("/api/swipes/event", { ok: false, latencyMs: Date.now() - started, error: evErr.message })
      return NextResponse.json({ error: evErr.message }, { status: 400 })
    }
    if (duplicateSwipe) {
      console.warn("[swipes/event] duplicate position (idempotent)", {
        sessionId: body.sessionId,
        position: body.position,
      })
    }

    const { data: events } = await admin
      .from("swipe_events")
      .select("candidate_id, direction")
      .eq("session_id", body.sessionId)
      .order("position", { ascending: true })

    const candIds = [...new Set((events ?? []).map((e) => e.candidate_id as string))]
    const { data: candRows } = await admin
      .from("outfit_candidates")
      .select("id, style_tags, brand_name")
      .in("id", candIds)

    const byId = new Map((candRows ?? []).map((r) => [r.id as string, r]))

    const signals: SwipeSignal[] =
      events?.map((e) => {
        const row = byId.get(e.candidate_id as string)
        return {
          candidateId: e.candidate_id as string,
          direction: e.direction as SwipeSignal["direction"],
          tags: (row?.style_tags as string[]) ?? [],
          brand: (row?.brand_name as string | null) ?? null,
        }
      }) ?? []

    const itemQuery = (access.sess.item_search_query as string | null)?.trim() || null
    const itemDeckOrder = (access.sess.item_deck_order as string[] | null) ?? null
    const isItemSession = Boolean(itemQuery)

    /** Style-profile Gemini phases — skipped for item-first sessions (ignore legacy outfit signals). */
    if (!isItemSession) {
      if (body.position === 3) {
        after(() => {
          void kickOffWebDiscover(admin, discoverKickOptsFromSignals(signals)).catch((e) =>
            console.warn("[swipes/event] web-discover (prefetch post-intro)", e),
          )
        })
      }
      if (body.position === 5) {
        after(() => {
          void runStyleIntroPhase(admin, body.sessionId, signals).catch((e) =>
            console.error("[swipes/event] runStyleIntroPhase", e),
          )
          void kickOffWebDiscover(admin, discoverKickOptsFromSignals(signals)).catch((e) =>
            console.warn("[swipes/event] web-discover (post-intro signals)", e),
          )
        })
      }
      if (body.position === 10 || body.position === 15) {
        after(() => {
          void (async () => {
            try {
              await runStyleRefinePhase(admin, body.sessionId, body.position, signals)
            } catch (e) {
              console.error("[swipes/event] runStyleRefinePhase", e)
            }
            void kickOffWebDiscover(admin, discoverKickOptsFromSignals(signals)).catch((e) =>
              console.warn("[swipes/event] web-discover (post-refine)", e),
            )
          })()
        })
      }
    }

    const targetCount = Number(access.sess.target_count ?? 12)
    const isUnlimited = targetCount <= 0

    if (!isUnlimited && body.position >= targetCount) {
      if (!isItemSession) {
        try {
          await runStyleRefinePhase(admin, body.sessionId, targetCount, signals)
        } catch (e) {
          console.error("[swipes/event] runStyleRefinePhase final", e)
        }
      }

      await admin
        .from("swipe_sessions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", body.sessionId)

      logApi("/api/swipes/event", { ok: true, latencyMs: Date.now() - started })
      return NextResponse.json({
        done: true,
        needsSummary: true,
        swipeCount: targetCount,
        nextCard: null,
        latencyMs: Date.now() - started,
      })
    }

    const { data: seenRows } = await admin
      .from("swipe_events")
      .select("candidate_id")
      .eq("session_id", body.sessionId)

    const seen = new Set((seenRows ?? []).map((r) => r.candidate_id as string))
    for (const id of body.excludeCandidateIds ?? []) {
      seen.add(id)
    }

    const { data: gRow } = await admin
      .from("swipe_sessions")
      .select("style_guidance")
      .eq("id", body.sessionId)
      .single()

    const pickGuidance = parseStylePickGuidance(gRow?.style_guidance)
    /** Next card’s 1-based swipe index in this session (matches `pickNextCandidates` intro filter). */
    const upcomingSwipeSlot = body.position + 2

    let rows: CandidateRow[]
    if (itemQuery) {
      if (itemDeckOrder?.length) {
        rows = await fetchItemDeckRowsOrdered(admin, itemDeckOrder, seen)
      } else {
        const ranked = await rankItemDeck(admin, itemQuery)
        await admin
          .from("swipe_sessions")
          .update({ item_deck_order: ranked.orderedIds })
          .eq("id", body.sessionId)
        rows = await fetchItemDeckRowsOrdered(admin, ranked.orderedIds, seen)
      }
    } else {
      rows = await loadCandidatePoolForSignals(admin, signals, {
        deckPosition: upcomingSwipeSlot,
        guidance: pickGuidance,
      })
    }

    const next = pickNextCandidates(rows, seen, signals, 1, {
      deckPosition: upcomingSwipeSlot,
      guidance: pickGuidance,
      upcomingSwipeStart: upcomingSwipeSlot,
    })
    const nextCard = next[0] ? candidateRowToOutfit(next[0]) : null

    logApi("/api/swipes/event", {
      ok: true,
      latencyMs: Date.now() - started,
      fallback: nextCard === null,
    })
    return NextResponse.json({
      done: false,
      swipeCount: body.position,
      nextCard,
      needsSummary: false,
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/swipes/event", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
