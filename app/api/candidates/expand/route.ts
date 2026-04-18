import { NextResponse } from "next/server"
import { z } from "zod"
import { createHash } from "crypto"
import { createServiceClient } from "@/lib/supabase/admin"
import { persistVisionCandidate } from "@/lib/ingest/persist-vision-candidate"
import { fetchUnsplashRandomPhotos } from "@/lib/ingest/unsplash-fashion"
import { logApi } from "@/lib/telemetry"

const bodySchema = z.object({
  count: z.number().int().min(1).max(30).optional(),
  query: z.string().max(200).optional(),
  /** Direct image URLs (e.g. CDN) — vision tags each; no Unsplash key required */
  imageUrls: z.array(z.string().url()).max(25).optional(),
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
      logApi("/api/candidates/expand", { ok: false, latencyMs: Date.now() - started, error: "401" })
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const json = await req.json().catch(() => ({}))
    const body = bodySchema.parse(json)
    const admin = createServiceClient()

    let inserted = 0
    let duplicates = 0
    const errors: string[] = []

    if (body.imageUrls?.length) {
      for (const imageUrl of body.imageUrls) {
        const id = createHash("sha256").update(imageUrl).digest("hex").slice(0, 24)
        const sourceUrl = `manual:image:${id}`
        const r = await persistVisionCandidate(admin, {
          sourceUrl,
          imageUrl,
          titleHint: "Fashion look",
          descriptionHint: null,
          brandName: null,
          priceRange: null,
          sourceType: "seed",
          freshnessScore: 2,
        })
        if (r.status === "inserted") inserted++
        else if (r.status === "duplicate") duplicates++
        else errors.push(r.message)
      }
    } else {
      const count = body.count ?? 12
      let photos: Awaited<ReturnType<typeof fetchUnsplashRandomPhotos>>
      try {
        photos = await fetchUnsplashRandomPhotos({ count, query: body.query })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unsplash fetch failed"
        logApi("/api/candidates/expand", { ok: false, latencyMs: Date.now() - started, error: msg })
        return NextResponse.json(
          {
            error: msg,
            hint: "Set UNSPLASH_ACCESS_KEY, or POST { imageUrls: [...] } with direct image URLs.",
          },
          { status: 400 },
        )
      }

      for (const p of photos) {
        const imageUrl = p.urls.regular || p.urls.raw
        if (!imageUrl) continue
        const hint =
          p.alt_description?.trim() ||
          p.description?.trim() ||
          "Editorial fashion look"
        const sourceUrl = `unsplash:photo:${p.id}`
        const r = await persistVisionCandidate(admin, {
          sourceUrl,
          imageUrl,
          titleHint: hint.slice(0, 200),
          descriptionHint: p.description?.trim() ?? p.alt_description?.trim() ?? null,
          brandName: null,
          priceRange: null,
          sourceType: "seed",
          freshnessScore: 2,
        })
        if (r.status === "inserted") inserted++
        else if (r.status === "duplicate") duplicates++
        else errors.push(r.message)
      }
    }

    logApi("/api/candidates/expand", { ok: true, latencyMs: Date.now() - started })
    return NextResponse.json({
      inserted,
      duplicates,
      errors: errors.slice(0, 10),
      message:
        "Swipe deck reads only from outfit_candidates. This route adds new rows; run it after deploy or on a schedule.",
      latencyMs: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    logApi("/api/candidates/expand", { ok: false, latencyMs: Date.now() - started, error: message })
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
