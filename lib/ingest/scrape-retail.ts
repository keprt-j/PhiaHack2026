import { load } from "cheerio"
import { createHash } from "crypto"

const ACCESSORY_SKU =
  /\b(socks|sock\b|underwear|briefs|boxers|thong|wallet|keychain|phone case|belt only|tie bar|cufflink)\b/i

const FULL_LOOK_HINTS_TEXT =
  /\b(outfit|full look|head\s*to\s*toe|styled look|lookbook|editorial|campaign|runway|collection|capsule|ensemble|co-ord|coordinates)\b/i

function isLikelyAccessoryOnlyPage(title: string, description: string | null): boolean {
  const blob = `${title} ${description ?? ""}`
  if (FULL_LOOK_HINTS_TEXT.test(blob)) return false
  return ACCESSORY_SKU.test(blob)
}

export type ScrapedProduct = {
  sourceUrl: string
  title: string
  description: string | null
  imageUrl: string
  brandName: string | null
  priceText: string | null
}

function hashUrl(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32)
}

function hostnameBrand(host: string): string | null {
  const parts = host.replace(/^www\./, "").split(".")
  if (parts.length < 2) return null
  const main = parts[parts.length - 2]
  return main ? main.charAt(0).toUpperCase() + main.slice(1) : null
}

function pickMeta($: ReturnType<typeof load>, prop: string): string | null {
  const el = $(`meta[property="${prop}"]`).attr("content")
  if (el) return el.trim()
  const name = $(`meta[name="${prop}"]`).attr("content")
  return name?.trim() ?? null
}

function pickAllOgImages($: ReturnType<typeof load>): string[] {
  const urls: string[] = []
  $('meta[property="og:image"], meta[property="og:image:url"]').each((_, el) => {
    const c = $(el).attr("content")?.trim()
    if (c) urls.push(c)
  })
  return urls
}

function collectImageCandidates($: ReturnType<typeof load>, pageUrl: string): string[] {
  const found = new Set<string>()

  for (const u of pickAllOgImages($)) found.add(u)
  const tw = pickMeta($, "twitter:image") || pickMeta($, "twitter:image:src")
  if (tw) found.add(tw)
  const secure = pickMeta($, "og:image:secure_url")
  if (secure) found.add(secure)
  const linkHref = $('link[rel="image_src"]').attr("href")
  if (linkHref) found.add(linkHref)

  // PDP hero / gallery (best-effort; sites vary a lot)
  $(
    '[data-testid*="hero"] img[src], [class*="ProductImage"] img[src], [class*="product-image"] img[src], picture source[srcset]',
  ).each((_, el) => {
    const $el = $(el)
    const src = $el.attr("src") || $el.attr("data-src") || $el.attr("srcset")?.split(/\s+/)[0]
    if (src?.startsWith("http") || src?.startsWith("//")) {
      try {
        found.add(new URL(src, pageUrl).href)
      } catch {
        /* skip */
      }
    }
  })

  return [...found]
}

const FULL_LOOK_URL_HINTS = [
  "look",
  "outfit",
  "model",
  "editorial",
  "campaign",
  "lookbook",
  "styling",
  "full",
  "hero",
  "runway",
  "collection",
  "ecom",
  "pdp-hero",
]

const BAD_IMAGE_HINTS = [
  "swatch",
  "thumb",
  "thumbnail",
  "icon",
  "sprite",
  "chip",
  "colorway",
  "50x50",
  "64x64",
  "96x96",
  "favicon",
]

function scoreImageForFullOutfit(absoluteUrl: string): number {
  let s = 0
  const u = absoluteUrl.toLowerCase()
  for (const h of FULL_LOOK_URL_HINTS) {
    if (u.includes(h)) s += 2.5
  }
  for (const b of BAD_IMAGE_HINTS) {
    if (u.includes(b)) s -= 8
  }

  const dimMatch =
    u.match(/[?&]w=(\d+)/i)?.[1] ||
    u.match(/[?&]width=(\d+)/i)?.[1] ||
    u.match(/\/(\d{3,4})w\b/i)?.[1]
  const dimH =
    u.match(/[?&]h=(\d+)/i)?.[1] ||
    u.match(/[?&]height=(\d+)/i)?.[1] ||
    u.match(/\/(\d{3,4})h\b/i)?.[1]

  const w = dimMatch ? parseInt(dimMatch, 10) : 0
  const h = dimH ? parseInt(dimH, 10) : 0
  if (w >= 900 && h >= 1100) s += 5
  if (h > 0 && w > 0 && h / w >= 1.15) s += 4
  if (w >= 1200 || h >= 1600) s += 2

  return s
}

function pickBestOutfitImage(candidates: string[], pageUrl: string): string | null {
  if (!candidates.length) return null
  const scored = candidates
    .map((raw) => {
      try {
        const abs = new URL(raw, pageUrl).href
        return { abs, score: scoreImageForFullOutfit(abs) }
      } catch {
        return { abs: raw, score: -100 }
      }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.abs ?? null
}

function isLikelyClothing(content: string): boolean {
  const text = content.toLowerCase()
  const apparelKeywords = [
    "shirt",
    "t-shirt",
    "tee",
    "top",
    "blouse",
    "jacket",
    "coat",
    "hoodie",
    "sweater",
    "cardigan",
    "dress",
    "skirt",
    "jeans",
    "denim",
    "pants",
    "trousers",
    "shorts",
    "leggings",
    "suit",
    "blazer",
    "fashion",
    "apparel",
    "clothing",
    "outfit",
    "knitwear",
    "outerwear",
  ]
  return apparelKeywords.some((k) => text.includes(k))
}

/**
 * Fetch a public retail PDP/listing page and extract OG metadata.
 * Prefers images that look like full looks (editorial/hero/large portrait) over swatches.
 */
export async function scrapeRetailProductPage(url: string): Promise<ScrapedProduct> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25_000)
  let res: Response
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Many retailers throttle or stall non-browser user agents on PDP HTML.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    })
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Fetch timed out after 25s for ${url}`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`)
  }

  const html = await res.text()
  const $ = load(html)

  const candidates = collectImageCandidates($, url)
  const imageUrl = pickBestOutfitImage(candidates.length ? candidates : [], url)

  const fallbackSingle =
    pickMeta($, "og:image") ||
    pickMeta($, "twitter:image") ||
    $('link[rel="image_src"]').attr("href") ||
    null

  const resolvedImage = imageUrl ?? (fallbackSingle ? new URL(fallbackSingle, url).href : null)

  if (!resolvedImage) {
    throw new Error("No suitable product or editorial image found")
  }

  const title =
    pickMeta($, "og:title") ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim() ||
    "Untitled look"

  const description = pickMeta($, "og:description") || pickMeta($, "description")

  const clothingSignal = `${title} ${description ?? ""} ${url}`
  if (!isLikelyClothing(clothingSignal)) {
    throw new Error("Scraped page does not appear to be clothing/apparel content")
  }

  if (isLikelyAccessoryOnlyPage(title, description)) {
    throw new Error("Page looks like a small accessory SKU — prefer full outfit / editorial PDP or lookbook URLs")
  }

  const priceText =
    pickMeta($, "product:price:amount") ||
    $("[itemprop=price]").attr("content") ||
    null

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    host = ""
  }

  const brandName = hostnameBrand(host)

  return {
    sourceUrl: url,
    title: title.slice(0, 200),
    description: description ? description.slice(0, 500) : null,
    imageUrl: resolvedImage,
    brandName,
    priceText,
  }
}

export function imageHashFromUrl(imageUrl: string): string {
  return hashUrl(imageUrl)
}
