/**
 * DEV / DEMO ONLY — anonymous Unsplash photos with weak brand/hashtag signal.
 * For real product goals use `pnpm run ingest:social` or retail ingest instead.
 *
 * Bulk-load: Unsplash discovery + vision tags → `outfit_candidates`.
 * Does not generate images; finds photo URLs and persists metadata (same as POST /api/candidates/expand).
 *
 * Required in `.env.local`: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY,
 * UNSPLASH_ACCESS_KEY
 *
 * Usage:
 *   pnpm run expand:catalog
 *   pnpm run expand:catalog -- --count=12 --rounds=4
 */
import { createServiceClient } from "@/lib/supabase/admin"
import { persistVisionCandidate } from "@/lib/ingest/persist-vision-candidate"
import { fetchUnsplashRandomPhotos } from "@/lib/ingest/unsplash-fashion"
import { loadEnvLocal } from "./load-env-local"

const DEFAULT_QUERIES = [
  "fashion editorial full body outfit street style portrait",
  "minimal capsule wardrobe lookbook model",
  "summer casual outfit full look outdoor",
  "streetwear hoodie sneakers full body",
  "smart casual office outfit look",
  "evening dress outfit editorial fashion",
] as const

function argNum(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!raw) return fallback
  const n = Number.parseInt(raw.split("=")[1] ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  loadEnvLocal()

  const countPerRound = Math.min(30, Math.max(1, argNum("count", 12)))
  const rounds = Math.min(DEFAULT_QUERIES.length, Math.max(1, argNum("rounds", DEFAULT_QUERIES.length)))

  if (!process.env.UNSPLASH_ACCESS_KEY) {
    console.error(
      "Missing UNSPLASH_ACCESS_KEY in .env.local — get a free key: https://unsplash.com/developers",
    )
    process.exit(1)
  }

  const admin = createServiceClient()
  let inserted = 0
  let duplicates = 0
  const errors: string[] = []

  for (let i = 0; i < rounds; i++) {
    const query = DEFAULT_QUERIES[i]!
    console.error(`[expand-catalog] round ${i + 1}/${rounds}: ${query.slice(0, 60)}…`)

    let photos: Awaited<ReturnType<typeof fetchUnsplashRandomPhotos>>
    try {
      photos = await fetchUnsplashRandomPhotos({ count: countPerRound, query })
    } catch (e) {
      console.error(e instanceof Error ? e.message : e)
      process.exit(1)
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

    if (i < rounds - 1) await sleep(400)
  }

  const summary = {
    ok: true,
    rounds,
    countPerRound,
    inserted,
    duplicates,
    errors: errors.slice(0, 15),
    note: "Images are discovered from Unsplash, not generated. Rows live in outfit_candidates.",
  }
  console.log(JSON.stringify(summary, null, 2))
  if (errors.length && inserted === 0 && duplicates === 0) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
