/**
 * Vision + optional Google Search grounding to suggest where to buy pieces
 * similar to the outfit in a post image.
 */

import { GoogleGenerativeAI, type GenerateContentResult, type ModelParams } from "@google/generative-ai"
import { z } from "zod"
import { fetchImageAsInlineData } from "@/lib/ai/image-fetch"
import {
  isSearchEngineShoppingUrl,
  normalizeShoppingUrlKey,
  retailerUrlLooksAlive,
} from "@/lib/ai/shopping-url-validate"
import { getDevGoogleSearchDisabled } from "@/lib/dev/google-search-flag"
import { mapWithConcurrency } from "@/lib/util/concurrency"

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"
const GENERATE_TIMEOUT_MS = 75_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini outfit shopping timed out")), ms)
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

function stripJsonFence(s: string): string {
  const t = s.trim()
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  }
  return t
}

const pieceSchema = z.object({
  label: z.string().max(120),
  item_type: z.string().max(48).optional(),
  search_query: z.string().max(220).optional(),
})

const linkSchema = z.object({
  title: z.string().max(200),
  url: z.string().url(),
  piece_label: z.string().max(120).optional(),
  match: z.enum(["similar", "exact", "unknown"]).optional(),
  retailer: z.string().max(80).optional(),
})

export const outfitShoppingPayloadSchema = z.object({
  summary: z.string().max(800),
  pieces: z.array(pieceSchema).max(12),
  links: z.array(linkSchema).max(24),
})

export type OutfitShoppingPayload = z.infer<typeof outfitShoppingPayloadSchema>

function getVisionModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const gen = new GoogleGenerativeAI(key)
  return gen.getGenerativeModel({ model: MODEL })
}

function getVisionSearchModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const gen = new GoogleGenerativeAI(key)
  const tools = [{ googleSearch: {} }] as unknown as ModelParams["tools"]
  return gen.getGenerativeModel({ model: MODEL, tools })
}

function looksFetchableUrl(url: string): boolean {
  const u = url.trim().toLowerCase()
  return (u.startsWith("https://") || u.startsWith("http://")) && u.length > 12
}

function groundingWebUris(res: GenerateContentResult): string[] {
  const chunks = res.response.candidates?.[0]?.groundingMetadata?.groundingChunks
  if (!chunks?.length) return []
  const out: string[] = []
  for (const ch of chunks) {
    const u = ch.web?.uri
    if (u && looksFetchableUrl(u)) out.push(u)
  }
  return [...new Set(out)]
}

function googleShoppingLink(query: string): string {
  const q = query.trim().slice(0, 200)
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`
}

/** Max total URL length for Lens GET links — avoid browser/proxy truncation. */
const MAX_LENS_URL_CHARS = 7200

/**
 * Opens Google Lens with the outfit image plus an optional text query for that piece.
 * Image-first product matches — there is no public stable “first Shopping thumbnail” URL without scraping SERPs.
 */
function googleLensShoppingLink(outfitImageUrl: string, pieceQuery: string): string {
  const u = new URL("https://lens.google.com/uploadbyurl")
  u.searchParams.set("url", outfitImageUrl.trim())
  const q = pieceQuery.trim().slice(0, 200)
  if (q) u.searchParams.set("q", q)
  const s = u.toString()
  if (s.length > MAX_LENS_URL_CHARS) {
    return googleShoppingLink(pieceQuery)
  }
  return s
}

function googleWebSearchLink(query: string): string {
  const q = query.trim().slice(0, 200)
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

const OUTFIT_SHOP_SEARCH_SYSTEM = `You can use Google Search. You are given ONE outfit photograph.

1) Identify distinct visible garments and accessories (tops, bottoms, shoes, outerwear, bags, jewelry, etc.).
2) For EACH piece, write a strong, specific pieces[].search_query a shopper could use today (include fit, color, gender if obvious) — this is the primary way users find in-stock items.
3) Use search to find REAL HTTPS pages on major retailers or brands where someone could buy the same item OR a close substitute. Strongly prefer: official store category/search URLs, current collection pages, or marketplace product pages. Avoid old editorial/blog posts, lookbooks from past seasons, dead news articles, or Pinterest unless it clearly links to a live storefront.

Output ONLY valid JSON (no markdown) with this exact shape:
{"summary":"2–4 sentences describing the overall look and shopping angle","pieces":[{"label":"short name for the piece","item_type":"e.g. footwear / outerwear / bag","search_query":"concise shopping query for this piece"}],"links":[{"title":"what this link helps you find","url":"https://...","piece_label":"must match a piece.label when applicable","match":"similar or exact or unknown","retailer":"store or site name if obvious"}]}

Rules:
- pieces: 3–10 entries when the outfit has that many distinct items; fewer if minimal outfit. search_query on every piece is REQUIRED and must be usable for live shopping search.
- links: 3–12 entries. Every url MUST be copied from Google Search grounding results — do NOT invent URLs. Skip a URL rather than using an obviously stale article. Prefer retailer domains (shop., www. brand TLDs, nordstrom.com, zara.com, ssense.com, farfetch.com, asos.com, etc.) over random blogs.
- match: use "exact" only when the listing plausibly matches the same product; otherwise "similar".
- summary must be grounded in what you see in the image.`

const OUTFIT_SHOP_VISION_ONLY = `You see ONE outfit photograph. No web search is available.

Identify distinct visible garments and accessories. For each, suggest a concise shopping search query someone could use (Google Shopping) to find a similar item.

Output ONLY valid JSON (no markdown):
{"summary":"2–4 sentences","pieces":[{"label":"...","item_type":"...","search_query":"..."}],"links":[]}

pieces: 3–10 entries when applicable. links must be an empty array [].`

function contextBlock(input: { title?: string; content?: string | null; outfitTags?: string[] }): string {
  const lines: string[] = []
  if (input.title?.trim()) lines.push(`post_title: ${input.title.trim().slice(0, 200)}`)
  if (input.content?.trim()) lines.push(`post_caption: ${input.content.trim().slice(0, 1500)}`)
  if (input.outfitTags?.length) lines.push(`outfit_tags: ${input.outfitTags.slice(0, 16).join(", ")}`)
  return lines.join("\n")
}

function mergeGroundingIntoLinks(
  parsed: OutfitShoppingPayload,
  groundingUris: string[],
): OutfitShoppingPayload {
  if (!groundingUris.length) return parsed
  const existing = new Set(parsed.links.map((l) => l.url.trim()))
  const extra: z.infer<typeof linkSchema>[] = []
  for (const uri of groundingUris) {
    if (existing.has(uri)) continue
    existing.add(uri)
    let host = "Shop"
    try {
      host = new URL(uri).hostname.replace(/^www\./, "")
    } catch {
      /* noop */
    }
    extra.push({
      title: `Browse — ${host}`,
      url: uri,
      match: "similar",
      retailer: host,
    })
    if (parsed.links.length + extra.length >= 18) break
  }
  return {
    ...parsed,
    links: [...parsed.links, ...extra].slice(0, 24),
  }
}

function addFallbackShoppingLinks(parsed: OutfitShoppingPayload, outfitImageUrl: string): OutfitShoppingPayload {
  const links = [...parsed.links]
  const seen = new Set(links.map((l) => normalizeShoppingUrlKey(l.url)))
  /** Prefer Lens (image + query) so results are image-led; fall back to tbm=shop if URL too long. */
  for (const p of parsed.pieces) {
    const q = (p.search_query ?? p.label).trim()
    if (!q) continue
    const url = googleLensShoppingLink(outfitImageUrl, q)
    const key = normalizeShoppingUrlKey(url)
    if (seen.has(key)) continue
    seen.add(key)
    const isLens = url.includes("lens.google.com")
    links.push({
      title: isLens ? `Visual shopping (Lens): ${p.label}` : `Live shopping search: ${p.label}`,
      url,
      piece_label: p.label,
      match: "similar",
      retailer: isLens ? "Google Lens" : "Google Shopping",
    })
    if (links.length >= 22) break
  }
  return { ...parsed, links }
}

function dedupeShoppingLinks(links: z.infer<typeof linkSchema>[]): z.infer<typeof linkSchema>[] {
  const seen = new Set<string>()
  const out: z.infer<typeof linkSchema>[] = []
  for (const l of links) {
    const k = normalizeShoppingUrlKey(l.url)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(l)
  }
  return out
}

function sortLinksLiveFirst(links: z.infer<typeof linkSchema>[]): z.infer<typeof linkSchema>[] {
  const rank = (url: string) => {
    try {
      const h = new URL(url).hostname.toLowerCase()
      if (h === "lens.google.com") return 0
      if (h === "google.com" || h.endsWith(".google.com")) return 1
      return 2
    } catch {
      return 2
    }
  }
  return [...links].sort((a, b) => {
    const ra = rank(a.url)
    const rb = rank(b.url)
    if (ra !== rb) return ra - rb
    return 0
  })
}

/**
 * Drops retailer URLs that clearly 404/410 (best-effort). Search-engine URLs are never checked.
 * Caps expensive checks via OUTFIT_SHOP_VALIDATE_URLS=0 to disable.
 */
async function finalizeShoppingLinks(links: z.infer<typeof linkSchema>[]): Promise<z.infer<typeof linkSchema>[]> {
  let out = dedupeShoppingLinks(links)
  if (process.env.OUTFIT_SHOP_VALIDATE_URLS === "0") {
    return sortLinksLiveFirst(out).slice(0, 24)
  }

  const searchNav: z.infer<typeof linkSchema>[] = []
  const external: z.infer<typeof linkSchema>[] = []
  for (const l of out) {
    if (isSearchEngineShoppingUrl(l.url)) searchNav.push(l)
    else external.push(l)
  }

  const toVerify = external.slice(0, 12)
  const tail = external.slice(12)

  const verified = await mapWithConcurrency(toVerify, 4, async (l) => {
    const ok = await retailerUrlLooksAlive(l.url)
    return ok ? l : null
  })
  const kept = verified.filter((x): x is z.infer<typeof linkSchema> => x !== null)

  out = [...searchNav, ...kept, ...tail]
  out = dedupeShoppingLinks(out)
  return sortLinksLiveFirst(out).slice(0, 24)
}

function parsePayload(text: string): OutfitShoppingPayload | null {
  try {
    const raw = JSON.parse(stripJsonFence(text))
    const r = outfitShoppingPayloadSchema.safeParse(raw)
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export type OutfitShoppingResult = {
  payload: OutfitShoppingPayload
  /** How links were produced */
  source: "search+vision" | "vision+fallback"
}

/**
 * Analyze the outfit image and return shopping links (grounded search when enabled),
 * or Google Shopping search URLs per piece as fallback.
 */
export async function suggestOutfitShopping(input: {
  imageUrl: string
  title?: string
  content?: string | null
  outfitTags?: string[]
}): Promise<OutfitShoppingResult | null> {
  const inline = await fetchImageAsInlineData(input.imageUrl)
  if (!inline) return null
  /** Prefer canonical image URL after og:image resolution — shorter and more reliable for Lens. */
  const outfitImageForLens = inline.resolvedUrl || input.imageUrl

  const ctx = contextBlock(input)
  const ctxBlock = ctx ? `\n\nOptional context (may help disambiguate; the image wins):\n${ctx}` : ""

  const useSearch =
    process.env.GEMINI_OUTFIT_SHOP !== "0" &&
    !getDevGoogleSearchDisabled()

  if (useSearch) {
    const model = getVisionSearchModel()
    if (model) {
      try {
        const prompt = `${OUTFIT_SHOP_SEARCH_SYSTEM}${ctxBlock}`
        const raw = await withTimeout(
          model.generateContent([prompt, { inlineData: { mimeType: inline.mimeType, data: inline.data } }]),
          GENERATE_TIMEOUT_MS,
        )
        const text = raw.response.text()
        const grounding = groundingWebUris(raw)
        let parsed = parsePayload(text)
        if (!parsed) {
          /** Minimal recovery: grounding URLs only */
          if (grounding.length) {
            parsed = {
              summary:
                "Here are shopping-related pages from search that may help you find similar pieces.",
              pieces: [],
              links: grounding.slice(0, 16).map((url) => {
                let host = "Store"
                try {
                  host = new URL(url).hostname.replace(/^www\./, "")
                } catch {
                  /* noop */
                }
                return { title: `Browse — ${host}`, url, match: "similar" as const, retailer: host }
              }),
            }
          }
        }
        if (parsed) {
          const merged = mergeGroundingIntoLinks(parsed, grounding)
          const withLive = addFallbackShoppingLinks(merged, outfitImageForLens)
          const links = await finalizeShoppingLinks(withLive.links)
          return { payload: { ...withLive, links }, source: "search+vision" }
        }
      } catch (e) {
        console.warn("[outfit-shop-gemini] search+vision failed", e)
      }
    }
  }

  const visionModel = getVisionModel()
  if (!visionModel) return null

  try {
    const prompt = `${OUTFIT_SHOP_VISION_ONLY}${ctxBlock}`
    const raw = await withTimeout(
      visionModel.generateContent([prompt, { inlineData: { mimeType: inline.mimeType, data: inline.data } }]),
      GENERATE_TIMEOUT_MS,
    )
    const text = raw.response.text()
    let parsed = parsePayload(text)
    if (!parsed) return null
    /** Turn suggested queries into Lens / Shopping links + one web search for the full look */
    parsed = addFallbackShoppingLinks(parsed, outfitImageForLens)
    const summaryQ = parsed.pieces
      .map((p) => p.search_query ?? p.label)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ")
    if (summaryQ.length > 8) {
      const url = googleWebSearchLink(`${summaryQ} outfit shop`)
      const seen = new Set(parsed.links.map((l) => normalizeShoppingUrlKey(l.url)))
      if (!seen.has(normalizeShoppingUrlKey(url))) {
        parsed = {
          ...parsed,
          links: [
            ...parsed.links,
            { title: "Search this look (Google)", url, match: "similar" as const, retailer: "Google" },
          ].slice(0, 24),
        }
      }
    }
    const links = await finalizeShoppingLinks(parsed.links)
    return { payload: { ...parsed, links }, source: "vision+fallback" }
  } catch (e) {
    console.warn("[outfit-shop-gemini] vision-only failed", e)
    return null
  }
}
