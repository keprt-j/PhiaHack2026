import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { candidateRowToOutfit, type CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"
import {
  buildGoogleShopSearchUrl,
  buildShopPicks,
  clusterLikedOutfits,
  resolveCandidateSourceUrl,
  type ShopPick,
} from "@/lib/item-swipe/cluster-and-shop"
import { logApi } from "@/lib/telemetry"

/**
 * Liked items from a finished item swipe session + clustered shop picks (working Google Shopping URLs).
 */
export async function GET(req: Request) {
  const started = Date.now()
  try {
    const sessionId = new URL(req.url).searchParams.get("sessionId")
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const supabaseAuth = await createClient()
    const {
      data: { user },
    } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createServiceClient()
    const { data: sess, error: sErr } = await admin
      .from("swipe_sessions")
      .select("id, user_id, item_search_query, completed_at")
      .eq("id", sessionId)
      .maybeSingle()

    if (sErr || !sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    if (sess.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (!sess.item_search_query) {
      return NextResponse.json({ error: "Not an item search session" }, { status: 400 })
    }

    const { count: swipeTotal } = await admin
      .from("swipe_events")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)

    const totalSwipes = typeof swipeTotal === "number" ? swipeTotal : 0

    const { data: events } = await admin
      .from("swipe_events")
      .select("candidate_id, direction")
      .eq("session_id", sessionId)
      .in("direction", ["right", "super"])
      .order("position", { ascending: true })

    const orderedIds: string[] = []
    const seen = new Set<string>()
    for (const e of events ?? []) {
      const id = e.candidate_id as string
      if (seen.has(id)) continue
      seen.add(id)
      orderedIds.push(id)
    }

    const itemSearchQuery = sess.item_search_query as string

    if (!orderedIds.length) {
      logApi("/api/item-swipes/summary", { ok: true, latencyMs: Date.now() - started })
      return NextResponse.json({
        itemSearchQuery,
        swipeCount: totalSwipes,
        liked: [] as Outfit[],
        shopPicks: [] as ShopPick[],
        clusters: [] as { memberCount: number; representative: Outfit }[],
      })
    }

    const { data: rows } = await admin.from("outfit_candidates").select("*").in("id", orderedIds)

    const byId = new Map((rows ?? []).map((r) => [r.id as string, r as CandidateRow]))
    const liked: Outfit[] = []
    for (const id of orderedIds) {
      const row = byId.get(id)
      if (!row) continue
      const base = candidateRowToOutfit(row)
      const resolved = resolveCandidateSourceUrl(row)
      liked.push({
        ...base,
        source_url: resolved ?? base.source_url ?? null,
      })
    }

    const clusters = clusterLikedOutfits(liked)
    const shopPicks = buildShopPicks(clusters, itemSearchQuery, totalSwipes, byId)

    const clustersOut = clusters.map((c) => ({
      memberCount: c.members.length,
      representative: c.representative,
    }))

    logApi("/api/item-swipes/summary", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      itemSearchQuery,
      swipeCount: totalSwipes,
      liked,
      shopPicks,
      clusters: clustersOut,
      /** Always-useful shopping URL for the session query */
      fallbackShopUrl: buildGoogleShopSearchUrl(itemSearchQuery),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/item-swipes/summary", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
