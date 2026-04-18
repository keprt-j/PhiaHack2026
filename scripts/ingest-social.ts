/**
 * Ingest a Pinterest / Instagram (best-effort) outfit URL: scrape + Gemini → outfit_candidates.
 * Requires `outfit_candidates` with social columns — run scripts/fresh_install.sql + seed_fresh.sql (or equivalent).
 *
 * Usage: pnpm run ingest:social -- "https://www.pinterest.com/pin/..."
 */
import { createServiceClient } from "@/lib/supabase/admin"
import { scrapeOutfitUrl } from "@/lib/ingest/scrape-outfit-url"
import { persistSocialLook } from "@/lib/ingest/persist-social-candidate"
import { loadEnvLocal } from "./load-env-local"

async function main() {
  loadEnvLocal()
  const url = process.argv.slice(2).find((a) => a.startsWith("http"))
  if (!url) {
    console.error('Usage: pnpm run ingest:social -- "https://..."')
    process.exit(1)
  }

  console.error("Fetching:", url)
  const scraped = await scrapeOutfitUrl(url)
  const admin = createServiceClient()
  const result = await persistSocialLook(admin, scraped)

  console.log(
    JSON.stringify(
      {
        scraped: { platform: scraped.platform, scrapeQuality: scraped.scrapeQuality },
        result,
      },
      null,
      2,
    ),
  )
  if (result.status === "error") process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
