/**
 * One-off retail ingest (same logic as POST /api/ingest/retail).
 * Usage: pnpm run ingest:retail -- <product-page-url>
 */
import { createServiceClient } from "@/lib/supabase/admin"
import { scrapeRetailProductPage } from "@/lib/ingest/scrape-retail"
import { persistVisionCandidate } from "@/lib/ingest/persist-vision-candidate"
import { loadEnvLocal } from "./load-env-local"

async function main() {
  loadEnvLocal()
  const url = process.argv.slice(2).find((a) => a.startsWith("http"))
  if (!url) {
    console.error("Usage: pnpm run ingest:retail -- <product-page-url>")
    process.exit(1)
  }

  console.error("Scraping:", url)
  const scraped = await scrapeRetailProductPage(url)
  const admin = createServiceClient()
  const result = await persistVisionCandidate(admin, {
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

  console.log(JSON.stringify(result, null, 2))
  if (result.status === "error") process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
