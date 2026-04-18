import type { createServiceClient } from "@/lib/supabase/admin"
import { classifySocialLook, enrichOutfitCardFromVision } from "@/lib/ai/gemini"
import { imageHashFromUrl } from "@/lib/ingest/scrape-retail"
import { isScrapeNoise, type OutfitPageScrape } from "@/lib/ingest/scrape-outfit-url"
import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import { candidateRowToOutfit } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"

type Admin = ReturnType<typeof createServiceClient>

function sourceContextPayload(scraped: OutfitPageScrape): Record<string, unknown> {
  return {
    explicit_hashtags: scraped.explicitHashtags,
    trend_phrases: scraped.trendPhrases,
    price_candidates: scraped.priceCandidates,
    scrape_quality: scraped.scrapeQuality,
    raw_caption_snippet: scraped.rawCaptionSnippet,
    platform: scraped.platform,
    scraped_text_low_signal: scraped.scrapedTextLowSignal,
  }
}

const PLATFORM_TAG = new Set(["pinterest", "instagram"])

function dropPlatformVibeTags(tags: string[], platform: string): string[] {
  const pl = platform.toLowerCase()
  return tags.filter((t) => {
    const k = t.toLowerCase()
    if (PLATFORM_TAG.has(k)) return false
    if (k === pl) return false
    return true
  })
}

export async function persistSocialLook(
  admin: Admin,
  scraped: OutfitPageScrape,
): Promise<
  | { status: "inserted"; candidate: Outfit; row: CandidateRow }
  | { status: "duplicate"; candidate: Outfit; row: CandidateRow }
  | { status: "error"; message: string }
> {
  const sourceUrl = scraped.canonicalUrl.split("?")[0]?.split("#")[0] ?? scraped.canonicalUrl

  const { data: existing } = await admin
    .from("outfit_candidates")
    .select("id")
    .eq("source_url", sourceUrl)
    .maybeSingle()

  if (existing?.id) {
    const { data: row } = await admin.from("outfit_candidates").select("*").eq("id", existing.id).single()
    if (row) {
      const r = row as CandidateRow
      return { status: "duplicate", candidate: candidateRowToOutfit(r), row: r }
    }
  }

  let classifierOutput = await classifySocialLook(scraped)

  const inferred = (classifierOutput.inferred_brands as string[] | undefined)?.filter(Boolean) ?? []
  const brandName = inferred[0] ?? null

  const priceFromModel =
    typeof classifierOutput.price_range === "string" && classifierOutput.price_range.trim()
      ? classifierOutput.price_range.trim().slice(0, 80)
      : null
  const priceRange = priceFromModel ?? scraped.priceCandidates[0] ?? null

  let cardTitle =
    typeof classifierOutput.card_title === "string" && classifierOutput.card_title.trim()
      ? String(classifierOutput.card_title).trim().slice(0, 200)
      : scraped.title.slice(0, 200)

  let cardDescription: string | null =
    typeof classifierOutput.card_description === "string" && classifierOutput.card_description.trim()
      ? String(classifierOutput.card_description).trim().slice(0, 500)
      : scraped.scrapedTextLowSignal
        ? null
        : scraped.description?.slice(0, 500) ?? null

  if (cardDescription && isScrapeNoise(cardDescription)) {
    cardDescription = null
  }
  if (!cardDescription && !scraped.scrapedTextLowSignal && scraped.description) {
    const d = scraped.description.trim()
    if (d && !isScrapeNoise(d)) cardDescription = d.slice(0, 500)
  }
  const looksLikePlaceholderTitle =
    scraped.scrapedTextLowSignal &&
    (/^pin on\b/i.test(cardTitle.trim()) ||
      /\bdiscover your vibe\b/i.test(cardTitle) ||
      /^outfit\s*$/i.test(cardTitle.trim()) ||
      /^photo\s*$/i.test(cardTitle.trim()))
  if (!cardDescription || isScrapeNoise(cardDescription) || looksLikePlaceholderTitle) {
    const enriched = await enrichOutfitCardFromVision({ imageUrl: scraped.imageUrl })
    if (enriched?.card_description && !isScrapeNoise(enriched.card_description)) {
      cardDescription = enriched.card_description.slice(0, 500)
    }
    if (enriched?.card_title?.trim() && !isScrapeNoise(enriched.card_title)) {
      cardTitle = enriched.card_title.trim().slice(0, 200)
    }
  }

  let tags = (classifierOutput.style_tags as string[] | undefined)?.filter(Boolean) ?? scraped.explicitHashtags
  tags = dropPlatformVibeTags(tags, scraped.platform)
  if (!tags.length) tags = ["discovered", "full-look"]

  const classifierForDb = {
    ...classifierOutput,
    card_title: cardTitle,
    card_description: cardDescription,
    source_context: sourceContextPayload(scraped),
  }

  const imageHash = imageHashFromUrl(scraped.imageUrl)

  const { data: inserted, error } = await admin
    .from("outfit_candidates")
    .insert({
      title: cardTitle,
      description: cardDescription,
      image_url: scraped.imageUrl,
      brand_name: brandName,
      price_range: priceRange,
      style_tags: tags,
      category: (classifierOutput.category as string) ?? "casual",
      source_url: sourceUrl,
      source_type: "social_scrape",
      source_platform: scraped.platform,
      source_context: sourceContextPayload(scraped),
      image_hash: imageHash,
      classifier_output: classifierForDb,
      freshness_score: 2,
    })
    .select("*")
    .single()

  if (error) {
    return { status: "error", message: error.message }
  }

  const row = inserted as CandidateRow
  return { status: "inserted", candidate: candidateRowToOutfit(row), row }
}
