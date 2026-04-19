import { z } from "zod"
import { GoogleGenerativeAI } from "@google/generative-ai"
import {
  classifierOutputSchema,
  socialClassifierOutputSchema,
  styleProfileSchema,
  type ClassifierOutput,
  type StyleProfileOutput,
} from "@/lib/ai/schemas"
import {
  CLASSIFIER_SOCIAL_VISION_SYSTEM,
  CLASSIFIER_TEXT_SYSTEM,
  CLASSIFIER_VISION_SYSTEM,
  ENRICH_OUTFIT_CARD_BRIEF,
  ENRICH_OUTFIT_CARD_VISION,
  STYLIST_SYSTEM,
} from "@/lib/ai/prompts"
import { fetchImageAsInlineData } from "@/lib/ai/image-fetch"
import type { OutfitPageScrape } from "@/lib/ingest/scrape-outfit-url"

/** Override with `GEMINI_MODEL` if you need a different release. */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"
/** Avoid hung `generateContent` calls blocking ingest / profile routes indefinitely */
const GENERATE_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini generateContent timed out")), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const gen = new GoogleGenerativeAI(key)
  return gen.getGenerativeModel({ model: MODEL })
}

type GeminiModel = NonNullable<ReturnType<typeof getModel>>

async function generateVisionRaw(
  model: GeminiModel,
  fullPrompt: string,
  inline: { mimeType: string; data: string },
): Promise<string> {
  const res = await withTimeout(
    model.generateContent([
      fullPrompt,
      { inlineData: { mimeType: inline.mimeType, data: inline.data } },
    ]),
    GENERATE_TIMEOUT_MS,
  )
  return res.response.text()
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  }
  return t
}

const enrichCardSchema = z.object({
  card_title: z.string().max(180),
  card_description: z.string().max(720),
})

/** Truncate / coerce model JSON so minor length issues do not force heuristic fallback */
function coerceClassifierJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const tags = Array.isArray(o.style_tags)
    ? o.style_tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12)
    : []
  const merged: Record<string, unknown> = {
    ...o,
    style_tags: tags.length ? tags : ["discovered"],
    card_title: typeof o.card_title === "string" ? o.card_title.trim().slice(0, 180) : o.card_title,
    card_description:
      typeof o.card_description === "string" ? o.card_description.trim().slice(0, 720) : o.card_description,
  }
  const r = classifierOutputSchema.safeParse(merged)
  return r.success ? (r.data as unknown as Record<string, unknown>) : null
}

function parseClassifierResponse(text: string): Record<string, unknown> {
  const parsed = JSON.parse(stripJsonFence(text))
  const direct = classifierOutputSchema.safeParse(parsed)
  if (direct.success) return direct.data as unknown as Record<string, unknown>
  const coerced = coerceClassifierJson(parsed)
  if (coerced) return coerced
  throw new Error("classifier_parse")
}

function coerceSocialClassifierJson(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const tags = Array.isArray(o.style_tags)
    ? o.style_tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 14)
    : []
  const brands = Array.isArray(o.inferred_brands)
    ? o.inferred_brands.filter((t): t is string => typeof t === "string").map((t) => t.trim()).slice(0, 5)
    : undefined
  const merged: Record<string, unknown> = {
    ...o,
    style_tags: tags.length ? tags : ["discovered"],
    card_title: typeof o.card_title === "string" ? o.card_title.trim().slice(0, 120) : o.card_title,
    card_description:
      typeof o.card_description === "string" ? o.card_description.trim().slice(0, 720) : o.card_description,
    inferred_brands: brands,
    price_range: typeof o.price_range === "string" ? o.price_range.trim().slice(0, 80) : o.price_range,
  }
  const r = socialClassifierOutputSchema.safeParse(merged)
  return r.success ? (r.data as unknown as Record<string, unknown>) : null
}

function parseSocialClassifierResponse(text: string): Record<string, unknown> {
  const parsed = JSON.parse(stripJsonFence(text))
  const direct = socialClassifierOutputSchema.safeParse(parsed)
  if (direct.success) return direct.data as unknown as Record<string, unknown>
  const coerced = coerceSocialClassifierJson(parsed)
  if (coerced) return coerced
  throw new Error("social_classifier_parse")
}

function socialContextBlock(scraped: OutfitPageScrape): string {
  const lines: string[] = [
    "primary_signal: outfit_image (card_title, card_description, and style_tags must reflect what you see in the photo)",
    `source_kind: ${scraped.platform}`,
    `scrape_quality: ${scraped.scrapeQuality}`,
    `scraped_text_low_signal: ${scraped.scrapedTextLowSignal}`,
  ]

  if (!scraped.scrapedTextLowSignal) {
    lines.push(`page_title: ${scraped.title}`)
    if (scraped.description) {
      lines.push(`page_description: ${scraped.description.slice(0, 2500)}`)
    }
  } else {
    const t = scraped.title.replace(/\s+/g, " ").trim()
    const titleUsable =
      t.length >= 28 && !/^pin on\b/i.test(t) && !/discover your vibe$/i.test(t)
    if (titleUsable) {
      lines.push(`optional_title_hint: ${t.slice(0, 300)}`)
    }
  }

  if (scraped.explicitHashtags.length) {
    lines.push(`explicit_hashtags_kebab: ${scraped.explicitHashtags.join(", ")}`)
  }
  if (scraped.trendPhrases.length) {
    lines.push(`trend_phrases: ${scraped.trendPhrases.join(", ")}`)
  }
  if (scraped.priceCandidates.length) {
    lines.push(`price_hints_from_text: ${scraped.priceCandidates.join(", ")}`)
  }
  if (!scraped.scrapedTextLowSignal && scraped.rawCaptionSnippet) {
    lines.push(`caption_snippet: ${scraped.rawCaptionSnippet}`)
  }

  return lines.join("\n")
}

function heuristicSocialClassifier(scraped: OutfitPageScrape): Record<string, unknown> {
  const tags = new Set<string>([...scraped.explicitHashtags, "full-look"])
  if (!scraped.scrapedTextLowSignal) {
    tags.add(scraped.platform)
  }
  for (const p of scraped.trendPhrases) {
    const k = p.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
    if (k.length > 2) tags.add(k.slice(0, 32))
  }
  const tagList = [...tags].filter(Boolean).slice(0, 12)
  const short = scraped.title.replace(/\s+/g, " ").trim().slice(0, 42)
  const card_title = short.includes("—")
    ? short.slice(0, 120)
    : `${short || "Styled look"} — Discover your vibe`
  const desc =
    scraped.description && !scraped.scrapedTextLowSignal
      ? scraped.description.slice(0, 500)
      : undefined
  return {
    style_tags: tagList.length ? tagList : ["discovered", "full-look"],
    card_title: card_title.slice(0, 120),
    card_description: desc,
    inferred_brands: [],
    price_range: scraped.priceCandidates[0],
    category: "casual",
    vibe_labels: tagList.slice(0, 4),
    occasion: "everyday",
    season: "all",
    silhouette: "mixed",
  }
}

/** Vision-first classifier for any ingest URL that yields an outfit image (+ optional page text). */
export async function classifySocialLook(scraped: OutfitPageScrape): Promise<Record<string, unknown>> {
  const model = getModel()
  if (!model) return heuristicSocialClassifier(scraped)

  const inline = await fetchImageAsInlineData(scraped.imageUrl)
  if (!inline) return heuristicSocialClassifier(scraped)

  const ctx = socialContextBlock(scraped)
  const prompt = `${CLASSIFIER_SOCIAL_VISION_SYSTEM}\n\n${ctx}`

  try {
    const out = await generateVisionRaw(model, prompt, inline)
    const parsed = parseSocialClassifierResponse(out)
    const modelTags = new Set<string>((parsed.style_tags as string[]) ?? [])
    for (const h of scraped.explicitHashtags) modelTags.add(h)
    const mergedTags = [...modelTags].slice(0, 14)
    return {
      ...parsed,
      style_tags: mergedTags.length ? mergedTags : (parsed.style_tags as string[]),
    }
  } catch {
    return heuristicSocialClassifier(scraped)
  }
}

function contextBlock(input: {
  title: string
  description: string | null
  brandName: string | null
  trendingHints?: string | null
}): string {
  return [
    input.title ? `page_title: ${input.title}` : "",
    input.description ? `page_description: ${input.description}` : "",
    input.brandName ? `inferred_brand: ${input.brandName}` : "",
    input.trendingHints ? `trend_hints: ${input.trendingHints}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export async function classifyCandidateStage1(input: {
  /** Hero image — primary signal when set */
  imageUrl: string | null
  title: string
  description: string | null
  brandName: string | null
  trendingHints?: string | null
}): Promise<Record<string, unknown>> {
  const model = getModel()
  const ctx = contextBlock(input)

  if (!model) {
    return heuristicClassifier(input)
  }

  const inline = input.imageUrl ? await fetchImageAsInlineData(input.imageUrl) : null

  try {
    if (inline) {
      const prompt = `${CLASSIFIER_VISION_SYSTEM}\n\nOptional page context (may disagree with image; trust the image):\n${ctx || "(none)"}`
      const out = await generateVisionRaw(model, prompt, inline)
      return parseClassifierResponse(out)
    }

    const prompt = `${CLASSIFIER_TEXT_SYSTEM}\n\n${ctx || `page_title: ${input.title}`}`
    const res = await withTimeout(model.generateContent(prompt), GENERATE_TIMEOUT_MS)
    const out = res.response.text()
    return parseClassifierResponse(out)
  } catch {
    return heuristicClassifier(input)
  }
}

/** Focused vision pass for outfit name + paragraph when the main classifier returns thin copy */
export async function enrichOutfitCardFromVision(input: { imageUrl: string }): Promise<{
  card_title: string
  card_description: string
} | null> {
  const model = getModel()
  if (!model) return null
  const inline = await fetchImageAsInlineData(input.imageUrl)
  if (!inline) return null
  try {
    const out = await generateVisionRaw(model, ENRICH_OUTFIT_CARD_VISION, inline)
    const parsed = JSON.parse(stripJsonFence(out))
    const s = enrichCardSchema.safeParse(parsed)
    return s.success ? s.data : null
  } catch {
    return null
  }
}

const enrichCardBriefSchema = z.object({
  /** Omitted or false = reject for web-discover (only explicit true passes the gate). */
  is_outfit: z.boolean().optional(),
  /** Clear subject + usable edges for segmentation / vector pipelines / API handoff — web-discover requires true. */
  pipeline_ready: z.boolean().optional(),
  card_title: z.string().max(60).default(""),
  card_description: z.string().max(180).default(""),
  style_tags: z.array(z.string()).max(12).optional(),
})

/**
 * Brief 2–3 word title + 5–10 word description. `is_outfit` is true only when the image
 * shows an adult wearing a coordinated full outfit; web-discover inserts only when true
 * and `pipeline_ready` (clear subject, integration-friendly composition).
 * Pass `inline` directly when you've already fetched the image (skips an HTTP round-trip).
 */
export async function enrichOutfitCardBriefFromVision(input: {
  imageUrl?: string
  inline?: { mimeType: string; data: string }
}): Promise<{
  is_outfit: boolean
  pipeline_ready: boolean
  card_title: string
  card_description: string
  style_tags: string[]
} | null> {
  const model = getModel()
  if (!model) return null
  const inline = input.inline ?? (input.imageUrl ? await fetchImageAsInlineData(input.imageUrl) : null)
  if (!inline) return null
  try {
    const out = await generateVisionRaw(model, ENRICH_OUTFIT_CARD_BRIEF, inline)
    const parsed = JSON.parse(stripJsonFence(out))
    const s = enrichCardBriefSchema.safeParse(parsed)
    if (!s.success) return null
    const tags = (s.data.style_tags ?? [])
      .map((t) => t.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
      .filter((t) => t.length >= 2)
      .slice(0, 12)
    return {
      is_outfit: s.data.is_outfit === true,
      pipeline_ready: s.data.pipeline_ready === true,
      card_title: s.data.card_title.trim(),
      card_description: s.data.card_description.trim(),
      style_tags: tags,
    }
  } catch {
    return null
  }
}

function heuristicClassifier(input: {
  title: string
  description: string | null
  brandName: string | null
  trendingHints?: string | null
}): ClassifierOutput {
  const blob = `${input.title} ${input.description ?? ""} ${input.trendingHints ?? ""}`.toLowerCase()
  const tags = new Set<string>(["discovered", "full-look"])
  const keywords: [string, string[]][] = [
    ["streetwear", ["street", "urban", "graphic", "cargo"]],
    ["minimal", ["minimal", "clean", "quiet"]],
    ["bohemian", ["boho", "layer", "festival"]],
    ["athleisure", ["sport", "gym", "run", "tech"]],
    ["formal", ["suit", "tailor", "blazer"]],
    ["vintage", ["retro", "90s", "70s"]],
  ]
  for (const [tag, keys] of keywords) {
    if (keys.some((k) => blob.includes(k))) tags.add(tag)
  }
  if (input.trendingHints) {
    for (const part of input.trendingHints.split(",").map((s) => s.trim().toLowerCase())) {
      if (part.length > 2) tags.add(part.replace(/\s+/g, "-"))
    }
  }
  if (input.brandName) tags.add(input.brandName.toLowerCase().replace(/\s+/g, "-"))
  return {
    style_tags: [...tags].slice(0, 10),
    category: "casual",
    vibe_labels: [...tags].slice(0, 4),
    occasion: "everyday",
    season: "all",
    silhouette: "mixed",
    brand_affinity_hint: input.brandName ?? undefined,
    card_title: input.title.slice(0, 120),
    card_description: input.description?.slice(0, 400) ?? undefined,
  }
}

export async function synthesizeStyleProfileStage2(input: {
  swipeSummary: string
}): Promise<StyleProfileOutput> {
  const model = getModel()
  const prompt = `${STYLIST_SYSTEM}\n\nPreference notes:\n${input.swipeSummary}`

  if (!model) {
    return deterministicProfile(input.swipeSummary)
  }

  try {
    const res = await withTimeout(model.generateContent(prompt), GENERATE_TIMEOUT_MS)
    const out = res.response.text()
    const parsed = JSON.parse(stripJsonFence(out))
    return styleProfileSchema.parse(parsed)
  } catch {
    return deterministicProfile(input.swipeSummary)
  }
}

function deterministicProfile(summary: string): StyleProfileOutput {
  const body = summary.trim().slice(0, 1200)
  return {
    style_name: "Your curated mix",
    profile_prompt: body
      ? `You're drawn to a mix that keeps shifting—here's what keeps showing up: ${body}`
      : "Your taste is still wide open—lean into silhouettes and palettes until a clear direction emerges.",
    traits: {
      exploration: 0.7,
      formality: 0.45,
      boldness: 0.55,
    },
    preferred_brands: [],
    disliked_brands: [],
    confidence: 0.55,
    rationale: "Fallback profile (model unavailable or parse failed).",
  }
}
