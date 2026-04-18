import type { createServiceClient } from "@/lib/supabase/admin"
import { classifyCandidateStage1, enrichOutfitCardFromVision } from "@/lib/ai/gemini"
import { imageHashFromUrl } from "@/lib/ingest/scrape-retail"
import { pickTrendingTermsForPage } from "@/lib/ingest/trending-style-terms"
import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import { candidateRowToOutfit } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"

type Admin = ReturnType<typeof createServiceClient>

/** Inserts use `retail_scrape` | `seed` — see DB CHECK on `outfit_candidates.source_type`. */
export type VisionCandidateSource = "retail_scrape" | "seed"

export async function persistVisionCandidate(
  admin: Admin,
  input: {
    sourceUrl: string
    imageUrl: string
    titleHint: string
    descriptionHint: string | null
    brandName: string | null
    priceRange: string | null
    sourceType: VisionCandidateSource
    /** Slightly boost new catalog rows in `order("freshness_score")` */
    freshnessScore?: number
    /** Used when the classifier returns no `style_tags` */
    fallbackStyleTags?: string[]
  },
): Promise<
  | { status: "inserted"; candidate: Outfit; row: CandidateRow }
  | { status: "duplicate"; candidate: Outfit; row: CandidateRow }
  | { status: "error"; message: string }
> {
  const { data: existing } = await admin
    .from("outfit_candidates")
    .select("id")
    .eq("source_url", input.sourceUrl)
    .maybeSingle()

  if (existing?.id) {
    const { data: row } = await admin.from("outfit_candidates").select("*").eq("id", existing.id).single()
    if (row) {
      const r = row as CandidateRow
      return { status: "duplicate", candidate: candidateRowToOutfit(r), row: r }
    }
  }

  const trendingHints = pickTrendingTermsForPage(input.sourceUrl, 6).join(", ")

  let classifierOutput: Record<string, unknown> | null = null
  try {
    classifierOutput = await classifyCandidateStage1({
      imageUrl: input.imageUrl,
      title: input.titleHint,
      description: input.descriptionHint,
      brandName: input.brandName,
      trendingHints,
    })
  } catch {
    classifierOutput = null
  }

  const tags =
    (classifierOutput?.style_tags as string[] | undefined)?.filter(Boolean) ??
    input.fallbackStyleTags ?? [
      input.sourceType === "seed" ? "catalog-expand" : "discovered",
      "ai-tagged",
    ]

  let cardTitle =
    typeof classifierOutput?.card_title === "string" && classifierOutput.card_title.trim()
      ? String(classifierOutput.card_title).trim().slice(0, 200)
      : input.titleHint.slice(0, 200)

  let cardDescription: string | null =
    typeof classifierOutput?.card_description === "string" && classifierOutput.card_description.trim()
      ? String(classifierOutput.card_description).trim().slice(0, 500)
      : input.descriptionHint

  const titleWeak =
    cardTitle.trim().length < 10 ||
    /^(fashion\s+look|editorial(\s+fashion)?|photo|image|untitled)\b/i.test(cardTitle.trim())
  const descWeak = !cardDescription || cardDescription.trim().length < 40

  if (input.imageUrl && (titleWeak || descWeak)) {
    const enriched = await enrichOutfitCardFromVision({ imageUrl: input.imageUrl })
    if (enriched) {
      if (titleWeak) cardTitle = enriched.card_title.slice(0, 200)
      if (descWeak) cardDescription = enriched.card_description.slice(0, 500)
      classifierOutput = {
        ...(classifierOutput ?? {}),
        card_title: cardTitle,
        card_description: cardDescription,
        card_copy_enriched: true,
      }
    }
  }

  const imageHash = imageHashFromUrl(input.imageUrl)

  const { data: inserted, error } = await admin
    .from("outfit_candidates")
    .insert({
      title: cardTitle,
      description: cardDescription,
      image_url: input.imageUrl,
      brand_name: input.brandName,
      price_range: input.priceRange,
      style_tags: tags,
      category: (classifierOutput?.category as string) ?? "casual",
      source_url: input.sourceUrl,
      source_type: input.sourceType,
      image_hash: imageHash,
      classifier_output: classifierOutput,
      freshness_score: input.freshnessScore ?? 1,
    })
    .select("*")
    .single()

  if (error) {
    return { status: "error", message: error.message }
  }

  const row = inserted as CandidateRow
  return { status: "inserted", candidate: candidateRowToOutfit(row), row }
}
