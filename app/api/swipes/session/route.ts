import { after, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { candidateRowToOutfit, type CandidateRow } from "@/lib/candidates/map-to-outfit"
import { pickNextCandidates, type SwipeSignal } from "@/lib/ranking/next-candidate"
import { buildItemDiscoverKickTheme } from "@/lib/ranking/item-query"
import { fetchItemDeckRowsOrdered, loadCandidatePoolForSignals, rankItemDeck } from "@/lib/ranking/load-pool"
import { discoverKickOptsFromSignals, kickOffWebDiscover } from "@/lib/ranking/web-discover"
import { logApi } from "@/lib/telemetry"

/** Item discover awaits Gemini/Unsplash; allow time on serverless hosts. */
export const maxDuration = 120

const TARGET = 12

type StartBody = {
  sessionId?: string
  guestSessionId?: string
  reset?: boolean
  unlimited?: boolean
  /** Typed item search — when set, deck is filtered to looks matching this product (e.g. "white pants"). */
  itemSearchQuery?: string
}

type Admin = ReturnType<typeof createServiceClient>

type Scope = "default" | "item"

async function resumeScoped(
  admin: Admin,
  filter: { user_id?: string | null; guest_session_id?: string },
  preferredId: string | undefined,
  scope: Scope,
  itemQueryExact?: string | null,
): Promise<string | null> {
  if (preferredId) {
    const { data } = await admin
      .from("swipe_sessions")
      .select("id, user_id, guest_session_id, completed_at, item_search_query")
      .eq("id", preferredId)
      .maybeSingle()
    if (!data || data.completed_at) return null
    const okUser =
      filter.user_id !== undefined
        ? data.user_id === filter.user_id
        : data.guest_session_id === filter.guest_session_id
    if (!okUser) return null
    if (scope === "default" && data.item_search_query != null) return null
    if (scope === "item") {
      if (data.item_search_query == null) return null
      if (itemQueryExact && data.item_search_query !== itemQueryExact) return null
    }
    return data.id as string
  }

  let q = admin.from("swipe_sessions").select("id").is("completed_at", null)
  q = filter.user_id !== undefined ? q.eq("user_id", filter.user_id) : q.eq("guest_session_id", filter.guest_session_id ?? "")
  if (scope === "default") {
    q = q.is("item_search_query", null)
  } else {
    q = q.not("item_search_query", "is", null)
    if (itemQueryExact) q = q.eq("item_search_query", itemQueryExact)
  }
  const { data } = await q.order("started_at", { ascending: false }).limit(1).maybeSingle()
  return data?.id ?? null
}

/**
 * Returns existing in-progress swipe session (so refresh keeps progress).
 * Pass `{ reset: true }` to force a brand-new default discover session (item_search_query IS NULL).
 */
export async function POST(req: Request) {
  const started = Date.now()
  try {
    const body = (await req.json().catch(() => ({}))) as StartBody
    const itemQRaw = typeof body.itemSearchQuery === "string" ? body.itemSearchQuery.trim() : ""
    const isItemMode = itemQRaw.length > 0

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
          .is("item_search_query", null)
      }

      if (isItemMode) {
        const existingId = body.reset
          ? null
          : await resumeScoped(admin, { user_id: user.id }, body.sessionId, "item", itemQRaw)

        if (existingId) {
          sessionId = existingId
          resumed = true
        } else {
          await admin
            .from("swipe_sessions")
            .update({ completed_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .is("completed_at", null)
            .not("item_search_query", "is", null)

          const { data: inserted, error } = await admin
            .from("swipe_sessions")
            .insert({
              user_id: user.id,
              guest_session_id: null,
              target_count: 0,
              item_search_query: itemQRaw,
            })
            .select("id")
            .single()

          if (error?.code === "23505") {
            const raced = await resumeScoped(admin, { user_id: user.id }, undefined, "item", itemQRaw)
            if (raced) {
              sessionId = raced
              resumed = true
            } else {
              console.error("[swipes/session] item unique", error)
              logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "session" })
              return NextResponse.json({ error: "Could not start item session" }, { status: 500 })
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
        const existingId = body.reset
          ? null
          : await resumeScoped(admin, { user_id: user.id }, body.sessionId, "default")

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
            await admin.from("swipe_sessions").update({ completed_at: new Date().toISOString() }).eq("id", existingId)
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
            const raced = await resumeScoped(admin, { user_id: user.id }, undefined, "default")
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
      }
    } else {
      const requestedGuest = body.guestSessionId
      if (isItemMode) {
        const existingId =
          !body.reset && requestedGuest
            ? await resumeScoped(admin, { guest_session_id: requestedGuest }, body.sessionId, "item", itemQRaw)
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
          const insertGuest = async (gid: string) =>
            admin
              .from("swipe_sessions")
              .insert({
                user_id: null,
                guest_session_id: gid,
                target_count: 0,
                item_search_query: itemQRaw,
              })
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
      } else {
        const existingId =
          !body.reset && requestedGuest
            ? await resumeScoped(admin, { guest_session_id: requestedGuest }, body.sessionId, "default")
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

    const { data: sessMeta } = await admin
      .from("swipe_sessions")
      .select("item_search_query, target_count, item_deck_order")
      .eq("id", sessionId)
      .single()

    const itemQuery = (sessMeta?.item_search_query as string | null)?.trim() || null
    const targetCountDb = typeof sessMeta?.target_count === "number" ? sessMeta.target_count : TARGET
    const deckOrder = (sessMeta?.item_deck_order as string[] | null) ?? null

    let seen = new Set((eventRows ?? []).map((e) => e.candidate_id as string))

    if (process.env.GEMINI_WEB_DISCOVER !== "0" && !itemQuery) {
      after(() => {
        void kickOffWebDiscover(admin, discoverKickOptsFromSignals(signals)).catch((e) =>
          console.warn("[swipes/session] web-discover", e),
        )
      })
    }

    let rows: CandidateRow[]
    if (itemQuery) {
      if (deckOrder?.length) {
        rows = await fetchItemDeckRowsOrdered(admin, deckOrder, seen)
      } else {
        if (process.env.GEMINI_WEB_DISCOVER !== "0") {
          try {
            await kickOffWebDiscover(admin, { query: buildItemDiscoverKickTheme(itemQuery) })
          } catch (e) {
            console.warn("[swipes/session] item discover (awaited)", e)
          }
        }
        const ranked = await rankItemDeck(admin, itemQuery)
        await admin
          .from("swipe_sessions")
          .update({ item_deck_order: ranked.orderedIds })
          .eq("id", sessionId)
        rows = await fetchItemDeckRowsOrdered(admin, ranked.orderedIds, seen)
        if (!rows.length) {
          rows = ranked.rows
        }
      }
    } else {
      rows = await loadCandidatePoolForSignals(admin, signals)
    }

    if (itemQuery && !rows.length && deckOrder?.length && deckOrder.every((id) => seen.has(id))) {
      await admin.from("swipe_sessions").update({ completed_at: new Date().toISOString() }).eq("id", sessionId)
      logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "item_exhausted" })
      return NextResponse.json(
        { error: "No more looks for this search — try different words.", code: "item_exhausted" },
        { status: 409 },
      )
    }

    if (!rows.length) {
      logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "no_pool" })
      return NextResponse.json({ error: "No outfit candidates in database" }, { status: 500 })
    }

    let swipeCount = eventRows?.length ?? 0
    let picked = pickNextCandidates(rows, seen, signals, 2, { upcomingSwipeStart: swipeCount + 1 })

    if (picked.length === 0 && (resumed || swipeCount > 0)) {
      const { data: cur } = await admin
        .from("swipe_sessions")
        .select("item_search_query")
        .eq("id", sessionId)
        .maybeSingle()
      if (cur?.item_search_query) {
        await admin.from("swipe_sessions").update({ completed_at: new Date().toISOString() }).eq("id", sessionId)
        logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: "item_exhausted" })
        return NextResponse.json(
          { error: "No more looks for this search — try different words.", code: "item_exhausted" },
          { status: 409 },
        )
      }

      await admin.from("swipe_sessions").update({ completed_at: new Date().toISOString() }).eq("id", sessionId)

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
        rows = await loadCandidatePoolForSignals(admin, [])
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
      targetCount: targetCountDb,
      resumed,
      swipeCount,
      itemSearchQuery: itemQuery,
      cards: picked.map((r) => candidateRowToOutfit(r)),
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/swipes/session", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
