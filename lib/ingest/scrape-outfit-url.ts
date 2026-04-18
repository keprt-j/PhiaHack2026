/**
 * Best-effort fetch of a public page that should contain a hero outfit image (social, blog, shop, etc.).
 * Uses OG/meta and light HTML heuristics; structure varies by site.
 */
import { load } from "cheerio"

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const

const FETCH_TIMEOUT_MS = 25_000

export type SocialPlatform = "pinterest" | "instagram" | "other"
export type ScrapeQuality = "full" | "partial"

export type OutfitPageScrape = {
  sourceUrl: string
  canonicalUrl: string
  platform: SocialPlatform
  imageUrl: string
  title: string
  description: string | null
  explicitHashtags: string[]
  trendPhrases: string[]
  priceCandidates: string[]
  scrapeQuality: ScrapeQuality
  rawCaptionSnippet: string | null
  /** Page gave little usable caption / hashtags — vision drives card copy */
  scrapedTextLowSignal: boolean
}

function detectPlatform(url: string): SocialPlatform {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "")
    if (h.includes("pinterest.")) return "pinterest"
    if (h.includes("instagram.")) return "instagram"
    return "other"
  } catch {
    return "other"
  }
}

function pickMeta($: ReturnType<typeof load>, prop: string): string | null {
  const el = $(`meta[property="${prop}"]`).attr("content")
  if (el) return el.trim()
  const name = $(`meta[name="${prop}"]`).attr("content")
  return name?.trim() ?? null
}

/** #tag tokens → kebab-case for style_tags */
export function normalizeHashtagTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

function extractHashtagsFromText(text: string): string[] {
  const seen = new Set<string>()
  const re = /#[\p{L}\p{N}_]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = normalizeHashtagTag(m[0])
    if (t.length >= 2) seen.add(t)
  }
  return [...seen]
}

const PRICE_LIKE =
  /\$\s?\d{1,4}(?:[.,]\d{2})?(?:\s*[-–]\s*\$\s?\d{1,4}(?:[.,]\d{2})?)?|\bUSD\s?\d+|\b\d+\s?(?:USD|EUR|GBP)\b/gi

function extractPriceCandidates(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(PRICE_LIKE.source, "gi")
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim()
    if (s && !out.includes(s)) out.push(s.slice(0, 40))
    if (out.length >= 5) break
  }
  return out
}

function extractTrendPhrases(title: string, desc: string | null): string[] {
  const blob = `${title} ${desc ?? ""}`
  const phrases: string[] = []
  const patterns = [
    /\b(spring|summer|fall|autumn|winter)\s+\d{4}\b/gi,
    /\b(cottagecore|coastal\s+grandmother|quiet\s+luxury|mob\s+wife|office\s+siren)\b/gi,
    /\b(streetwear|y2k|90s|70s|minimal|maximal)\b/gi,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    const r = new RegExp(re.source, re.flags)
    while ((m = r.exec(blob)) !== null) {
      const p = m[0].trim().toLowerCase()
      if (p.length > 2 && !phrases.includes(p)) phrases.push(p.slice(0, 48))
    }
  }
  return phrases.slice(0, 8)
}

/** Generic meta/OG lines — not usable as outfit copy */
export function isScrapeNoise(text: string | null | undefined): boolean {
  if (!text || text.length < 12) return true
  const t = text.toLowerCase()
  const bad = [
    "discover (and save!) your own pins",
    "this pin was discovered by",
    "this pin was created on",
    "discover more inspiration on pinterest",
    "visit site",
    "see more ideas about",
  ]
  if (bad.some((b) => t.includes(b))) return true
  if (/^pin on\b/i.test(text.trim()) && text.length < 80) return true
  return false
}

function unescapeJsonStringChunk(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/\\"/g, '"').replace(/\\\\/g, "\\")}"`) as string
  } catch {
    return s.replace(/\\n/g, " ").replace(/\\"/g, '"').trim()
  }
}

function extractLdJsonText(html: string): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {}
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1]!.trim()) as unknown
      const nodes = Array.isArray(j) ? j : [j]
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue
        const o = node as Record<string, unknown>
        const typ = (o["@type"] as string | undefined)?.toLowerCase() ?? ""
        if (!typ.includes("article") && !typ.includes("product") && !typ.includes("image")) continue
        if (typeof o.name === "string" && o.name.length > 3 && !/^pin on\b/i.test(o.name)) {
          out.title = o.name.slice(0, 300)
        }
        if (typeof o.description === "string" && o.description.length > 40 && !isScrapeNoise(o.description)) {
          out.description = o.description.slice(0, 2000)
        }
      }
    } catch {
      /* skip */
    }
  }
  return out
}

/** Best-effort: some hosts embed richer copy in JSON (e.g. Pinterest). */
function extractEmbeddedJsonHints(html: string): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {}

  const alt = html.match(/"seo_alt_text"\s*:\s*"((?:[^"\\]|\\.){10,2000})"/)
  if (alt?.[1]) {
    const d = unescapeJsonStringChunk(alt[1])
    if (d.length > 15 && !isScrapeNoise(d)) out.description = d.slice(0, 2000)
  }

  const rich = html.match(/"description"\s*:\s*"((?:[^"\\]|\\.){20,2000})"\s*,\s*"domain"/)
  if (rich?.[1] && !out.description) {
    const d = unescapeJsonStringChunk(rich[1])
    if (d.length > 20 && !isScrapeNoise(d)) out.description = d.slice(0, 2000)
  }

  const grid = html.match(/"grid_title"\s*:\s*"((?:[^"\\]|\\.){5,400})"/)
  if (grid?.[1]) {
    const ti = unescapeJsonStringChunk(grid[1])
    if (ti.length > 3 && !/^pin on\b/i.test(ti)) out.title = ti.slice(0, 300)
  }

  const close = html.match(/"text"\s*:\s*"((?:[^"\\]|\\.){15,2500})"\s*,\s*"entities"/)
  if (close?.[1] && !out.description) {
    const d = unescapeJsonStringChunk(close[1])
    if (d.length > 15 && !isScrapeNoise(d)) out.description = d.slice(0, 2000)
  }

  return out
}

function bestOgImage($: ReturnType<typeof load>, pageUrl: string): string | null {
  const og = pickMeta($, "og:image") || pickMeta($, "og:image:url")
  if (og) {
    try {
      return new URL(og, pageUrl).href
    } catch {
      return og.startsWith("http") ? og : null
    }
  }
  const tw = pickMeta($, "twitter:image") || pickMeta($, "twitter:image:src")
  if (tw) {
    try {
      return new URL(tw, pageUrl).href
    } catch {
      return tw.startsWith("http") ? tw : null
    }
  }
  return null
}

export async function scrapeOutfitUrl(url: string): Promise<OutfitPageScrape> {
  const platform = detectPlatform(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: BROWSER_HEADERS,
      redirect: "follow",
    })
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`)
  }

  const html = await res.text()
  const finalUrl = res.url || url
  const $ = load(html)

  let title =
    pickMeta($, "og:title") ||
    $("title").first().text().trim() ||
    "Outfit"
  let description = pickMeta($, "og:description") || pickMeta($, "description")

  const ld = extractLdJsonText(html)
  const embedded = platform === "pinterest" ? extractEmbeddedJsonHints(html) : {}
  if (embedded.title && !/^pin on\b/i.test(embedded.title.trim())) {
    title = embedded.title
  } else if (ld.title && !/^pin on\b/i.test(ld.title.trim())) {
    title = ld.title
  }

  if (embedded.description && !isScrapeNoise(embedded.description)) {
    description = embedded.description
  } else if (ld.description && !isScrapeNoise(ld.description)) {
    description = ld.description
  } else if (description && isScrapeNoise(description)) {
    description = embedded.description ?? ld.description ?? description
    if (isScrapeNoise(description)) description = null
  }

  const imageUrl = bestOgImage($, finalUrl)
  if (!imageUrl) {
    throw new Error("No og:image found — page may require login or block bots")
  }

  const captionBlob = `${title}\n${description ?? ""}`
  const explicitHashtags = extractHashtagsFromText(captionBlob)
  const priceCandidates = extractPriceCandidates(captionBlob)
  const trendPhrases = extractTrendPhrases(title, description)

  const hasRichCaption =
    Boolean(description && description.length >= 20 && !isScrapeNoise(description))
  const scrapedTextLowSignal = !hasRichCaption && explicitHashtags.length === 0

  let scrapeQuality: ScrapeQuality = "full"
  if (platform === "instagram") {
    if (!description || description.length < 20) scrapeQuality = "partial"
    if (explicitHashtags.length === 0 && (!description || description.length < 40)) {
      scrapeQuality = "partial"
    }
  }
  if (explicitHashtags.length === 0 && (!description || description.length < 30)) {
    scrapeQuality = "partial"
  }
  if (scrapedTextLowSignal) scrapeQuality = "partial"

  const rawCaptionSnippet = description ? description.slice(0, 500) : null

  return {
    sourceUrl: url,
    canonicalUrl: finalUrl,
    platform,
    imageUrl,
    title: title.slice(0, 300),
    description: description ? description.slice(0, 2000) : null,
    explicitHashtags,
    trendPhrases,
    priceCandidates,
    scrapeQuality,
    rawCaptionSnippet,
    scrapedTextLowSignal,
  }
}
