import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/admin"
import { scrapeOutfitUrl } from "@/lib/ingest/scrape-outfit-url"
import { persistSocialLook } from "@/lib/ingest/persist-social-candidate"
import { logApi } from "@/lib/telemetry"

const bodySchema = z.object({
  url: z.string().url(),
})

function authorize(req: Request): boolean {
  const secret = process.env.INGEST_SECRET
  if (!secret) return false
  const h = req.headers.get("x-ingest-secret")
  const auth = req.headers.get("authorization")
  if (h === secret) return true
  if (auth === `Bearer ${secret}`) return true
  return false
}

export async function POST(req: Request) {
  const started = Date.now()
  try {
    if (!authorize(req)) {
      logApi("/api/ingest/social", { ok: false, latencyMs: Date.now() - started, error: "401" })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await req.json()
    const { url } = bodySchema.parse(json)

    const scraped = await scrapeOutfitUrl(url)
    const supabase = createServiceClient()
    const result = await persistSocialLook(supabase, scraped)

    if (result.status === "error") {
      console.error("[ingest/social]", result.message)
      logApi("/api/ingest/social", { ok: false, latencyMs: Date.now() - started, error: result.message })
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    logApi("/api/ingest/social", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      candidate: result.candidate,
      duplicate: result.status === "duplicate",
      platform: scraped.platform,
      scrapeQuality: scraped.scrapeQuality,
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("[ingest/social]", e)
    logApi("/api/ingest/social", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
