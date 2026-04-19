import type { CandidateRow } from "@/lib/candidates/map-to-outfit"
import type { Outfit } from "@/lib/types"

export type CandidateLike = {
  source_url?: string | null
  source_context?: Record<string, unknown> | null
  image_url: string
  source_type?: string | null
}

/**
 * Prefer real page URLs from ingest when present (retail PDP, editorial, pin page).
 */
export function resolveCandidateSourceUrl(row: CandidateLike): string | null {
  const ctx = row.source_context
  if (ctx && typeof ctx === "object") {
    const o = ctx as Record<string, unknown>
    for (const k of ["page_url", "canonical_url", "product_url", "retail_url", "source_page_url"]) {
      const v = o[k]
      if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) return v.trim()
    }
  }

  const su = (row.source_url ?? "").trim()
  if (/^https?:\/\//i.test(su) && !su.startsWith("web-gemini:")) {
    return su
  }
  const origin =
    ctx && typeof ctx === "object" && "image_origin" in ctx && typeof (ctx as { image_origin?: unknown }).image_origin === "string"
      ? (ctx as { image_origin: string }).image_origin.trim()
      : ""
  if (/^https?:\/\//i.test(origin)) return origin
  const img = (row.image_url ?? "").trim()
  if (/^https?:\/\//i.test(img)) return img
  return null
}

export function buildGoogleShopSearchUrl(searchQuery: string): string {
  const q = searchQuery.replace(/\s+/g, " ").trim().slice(0, 220)
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`
}

/** True when URL is almost certainly a hotlinked image, not a store/editorial page. */
export function isLikelyRawImageUrl(url: string): boolean {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  const base = path.split("?")[0]
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(base)) return true
  if (url.includes("images.unsplash.com") || url.includes("plus.unsplash.com")) return true
  if (url.includes("i.pinimg.com") || url.includes("pinimg.com/originals")) return true
  if (url.includes("pbs.twimg.com")) return true
  /** Post / profile pages are shoppable context; image CDN hosts are not */
  if (/\.cdninstagram\.com|scontent.*\.cdninstagram/i.test(url)) return true
  return false
}

const RETAIL_HOST_RE =
  /nordstrom|shopbop|net-a-porter|matchesfashion|ssense|farfetch|mytheresa|asos|uniqlo|jcrew|bananarepublic|macys|bloomingdales|saks|rei|patagonia|nike|adidas|footlocker|mrporter|luisaviaroma|therealreal|poshmark|depop|etsy|amazon|target|walmart|kohls|urbanoutfitters|anthropologie|freepeople|madewell|everlane|cos\.|arket|\.zara\.|hm\.com|gap\.com|shop\.app|shein|boohoo|prettylittlething|fashionnova|lulus|revolve|shopbop|temu|ebay|mercari|grailed|stockx|goat\.com|finishline|dsw|zappos|vans|converse|newbalance|underarmour|lululemon|alo|gymshark|princesspolly|hellomolly/i

function looksLikeRetailerHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    if (RETAIL_HOST_RE.test(h)) return true
    /** Subdomains like shop.brand.com */
    if (/^shop\.|^store\.|^buy\./.test(h)) return true
    return false
  } catch {
    return false
  }
}

/** Path suggests a browse / buy surface (not necessarily a known brand). */
function looksLikeCommercePath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase()
    return /\/(shop|store|catalog|collection|collections|mens|womens|men|women|clothing|apparel|new|sale|product|products|p\/|dp\/|itm\/|item\/|buy)\b/.test(p)
  } catch {
    return false
  }
}

function looksLikeProductPath(url: string): boolean {
  try {
    const p = new URL(url).pathname.toLowerCase()
    return (
      /\/(product|products|p|dp|item|sku|buy)\b/.test(p) ||
      /\/p\/[\w-]+/.test(p) ||
      /\/itm\//.test(p)
    )
  } catch {
    return false
  }
}

/**
 * Higher = better “buy / browse the actual clothes” destination (not a raw image CDN).
 */
export function purchaseLinkScore(url: string, sourceType: string | null | undefined): number {
  let s = 0
  const st = sourceType ?? ""
  if (st === "retail_scrape") s += 120
  else if (st === "social_scrape") s += 85
  else if (st === "web_gemini") s += 30
  else if (st === "seed") s += 12

  if (isLikelyRawImageUrl(url)) s -= 75
  if (looksLikeRetailerHost(url)) s += 55
  if (looksLikeProductPath(url)) s += 35
  if (looksLikeCommercePath(url)) s += 28
  /** Pinterest / editorial article pages are still better than a .jpg hotlink */
  try {
    const host = new URL(url).hostname
    if (/pinterest\.|vogue\.|whowhatwear\.|hypebeast\.|highsnobiety\./i.test(host)) s += 25
    /** Social post pages (often link out to products) */
    if (/instagram\.com\/(p|reel)\//i.test(url)) s += 30
    if (/tiktok\.com\/@/i.test(url)) s += 18
  } catch {
    /* ignore */
  }
  return s
}

export type BestPurchaseLink = {
  url: string
  score: number
  sourceType: string | null
}

/** Pick the best real destination URL among liked candidates (for shop cards). */
export function pickBestPurchaseLinkForCluster(members: Outfit[], rowById: Map<string, CandidateRow>): BestPurchaseLink | null {
  let best: BestPurchaseLink | null = null
  for (const o of members) {
    const row = rowById.get(o.id)
    if (!row) continue
    const url = resolveCandidateSourceUrl(row)
    if (!url) continue
    if (isGoogleShoppingUrl(url)) continue
    const score = purchaseLinkScore(url, row.source_type)
    if (!best || score > best.score) {
      best = { url, score, sourceType: row.source_type ?? null }
    }
  }
  return best
}

function isGoogleShoppingUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.includes("google.") && (u.pathname.includes("/search") || u.searchParams.get("tbm") === "shop")
  } catch {
    return false
  }
}

/**
 * Prefer any retailer / store / editorial / social post link for the clothing.
 * Google Shopping is never used as primary — it stays the secondary CTA only.
 */
export function pickRetailerPrimaryUrl(best: BestPurchaseLink | null): string | null {
  if (!best) return null
  if (isGoogleShoppingUrl(best.url)) return null
  if (isLikelyRawImageUrl(best.url)) return null
  /** Ingested retail / social always surface */
  if (best.sourceType === "retail_scrape" || best.sourceType === "social_scrape") return best.url
  /** Known store, commerce path, or strong score = treat as retailer / shop destination */
  if (
    looksLikeRetailerHost(best.url) ||
    looksLikeProductPath(best.url) ||
    looksLikeCommercePath(best.url) ||
    best.score >= 38
  ) {
    return best.url
  }
  /** Last resort: usable https page that isn’t clearly just a hotlinked file */
  if (best.score >= 22) return best.url
  return null
}

function tagSet(o: Outfit): Set<string> {
  return new Set((o.style_tags ?? []).map((t) => String(t).toLowerCase()).filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter++
  }
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Merge outfits whose style tag sets overlap enough (similar-looking / same vibe in catalog).
 */
export function clusterLikedOutfits(liked: Outfit[], jaccardThreshold = 0.38): { representative: Outfit; members: Outfit[] }[] {
  if (liked.length <= 1) {
    return liked.length ? [{ representative: liked[0], members: [...liked] }] : []
  }

  let clusters: Outfit[][] = liked.map((o) => [o])
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < clusters.length; i++) {
      const tagsI = tagSet(clusters[i][0])
      for (let j = i + 1; j < clusters.length; j++) {
        const tagsJ = tagSet(clusters[j][0])
        const unionTags = new Set([...tagsI, ...tagsJ])
        let best = 0
        for (const o of clusters[i]) {
          for (const p of clusters[j]) {
            best = Math.max(best, jaccard(tagSet(o), tagSet(p)))
          }
        }
        const sim = best > 0 ? best : jaccard(tagsI, tagsJ)
        if (sim >= jaccardThreshold || (unionTags.size <= 4 && sim >= 0.22)) {
          clusters[i] = [...clusters[i], ...clusters[j]]
          clusters.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }

  return clusters.map((members) => ({
    representative: members[0],
    members,
  }))
}

export type ShopPick = {
  label: string
  thumbnailUrl: string
  likedCount: number
  /** Retailer / store / editorial / social page — always shown first when present. */
  retailerUrl: string | null
  /** Google Shopping search — secondary “similar items” fallback. */
  googleShopUrl: string
}

function shortenLabel(s: string, max = 52): string {
  const t = s.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/**
 * ~2 shop picks per 6 swipes → `maxPicks = max(1, round(totalSwipes / 3))`.
 * Retailer / source link first when available; Google Shopping always second.
 */
export function buildShopPicks(
  clusters: { representative: Outfit; members: Outfit[] }[],
  itemSearchQuery: string,
  totalSwipes: number,
  rowById: Map<string, CandidateRow>,
): ShopPick[] {
  const maxPicks = Math.max(1, Math.round(Math.max(1, totalSwipes) / 3))
  const sorted = [...clusters].sort((a, b) => b.members.length - a.members.length || b.representative.likes_count - a.representative.likes_count)
  const take = sorted.slice(0, maxPicks)

  const seenRetailer = new Set<string>()
  const out: ShopPick[] = []

  for (const c of take) {
    const q = [itemSearchQuery, c.representative.title, c.representative.brand].filter(Boolean).join(" ").trim()
    const googleShopUrl = buildGoogleShopSearchUrl(q)

    const best = pickBestPurchaseLinkForCluster(c.members, rowById)
    let retailerUrl = best ? pickRetailerPrimaryUrl(best) : null
    if (retailerUrl && seenRetailer.has(retailerUrl)) retailerUrl = null
    if (retailerUrl) seenRetailer.add(retailerUrl)

    out.push({
      label: shortenLabel(c.representative.title || itemSearchQuery),
      thumbnailUrl: c.representative.image_url,
      likedCount: c.members.length,
      retailerUrl,
      googleShopUrl,
    })
  }

  return out
}
