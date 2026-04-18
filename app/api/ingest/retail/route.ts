import { NextResponse } from "next/server"
import { z } from "zod"
import { createServiceClient } from "@/lib/supabase/admin"
import { scrapeRetailProductPage } from "@/lib/ingest/scrape-retail"
import { persistVisionCandidate } from "@/lib/ingest/persist-vision-candidate"
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
      logApi("/api/ingest/retail", { ok: false, latencyMs: Date.now() - started, error: "401" })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await req.json()
    const { url } = bodySchema.parse(json)

    const scraped = await scrapeRetailProductPage(url)
    const supabase = createServiceClient()

    const result = await persistVisionCandidate(supabase, {
      sourceUrl: scraped.sourceUrl,
      imageUrl: scraped.imageUrl,
      titleHint: scraped.title,
      descriptionHint: scraped.description,
      brandName: scraped.brandName,
      priceRange: scraped.priceText,
      sourceType: "retail_scrape",
      freshnessScore: 1,
      fallbackStyleTags: ["discovered", "retail"],
    })

    if (result.status === "error") {
      console.error("[ingest/retail]", result.message)
      logApi("/api/ingest/retail", { ok: false, latencyMs: Date.now() - started, error: result.message })
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    const fallbackClassifier = result.row.classifier_output == null

    logApi("/api/ingest/retail", {
      ok: true,
      latencyMs: Date.now() - started,
      fallback: result.status === "duplicate" ? undefined : fallbackClassifier,
    })
    return NextResponse.json({
      candidate: result.candidate,
      duplicate: result.status === "duplicate",
      latencyMs: Date.now() - started,
      fallbackClassifier: result.status === "duplicate" ? undefined : fallbackClassifier,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    console.error("[ingest/retail]", e)
    logApi("/api/ingest/retail", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message, latencyMs: Date.now() - started }, { status: 400 })
  }
}
