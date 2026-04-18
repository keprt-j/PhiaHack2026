/**
 * Outfit images from the Unsplash API (Search) — reliable URLs, no Pinterest hotlink issues.
 * @see https://unsplash.com/documentation#search-photos
 */

import type { WebDiscoveredItem } from "@/lib/ai/gemini-web-images"

function buildSearchQuery(theme: string): string {
  const t = theme
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  /** Anchor: single subject, portrait orientation, full look — better for downstream cutout / vector / API use. */
  const anchor =
    "adult fashion outfit full body one person isolated subject clean background street style editorial"
  const base = t.length ? `${t} ${anchor}` : `${anchor} portrait`
  return base
}

/**
 * Search Unsplash for portrait fashion/outfit photography. Returns items compatible with
 * `persistWebDiscoverCandidates` (image URLs are stable `images.unsplash.com` links).
 */
export async function discoverOutfitPhotosFromUnsplash(
  theme: string,
  opts?: { perPage?: number },
): Promise<WebDiscoveredItem[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim()
  if (!key) {
    console.warn("[unsplash-discover] UNSPLASH_ACCESS_KEY not set")
    return []
  }

  const perPage = Math.min(30, Math.max(6, opts?.perPage ?? 15))
  const query = buildSearchQuery(theme)

  const url = new URL("https://api.unsplash.com/search/photos")
  url.searchParams.set("query", query)
  url.searchParams.set("per_page", String(perPage))
  url.searchParams.set("orientation", "portrait")
  url.searchParams.set("content_filter", "high")

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Client-ID ${key}`,
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    const t = await res.text()
    console.warn("[unsplash-discover] API", res.status, t.slice(0, 200))
    return []
  }

  const data = (await res.json()) as {
    results?: Array<{
      id: string
      urls?: { regular?: string; small?: string }
      alt_description?: string | null
      description?: string | null
    }>
  }

  const results = data.results ?? []
  const seen = new Set<string>()
  const out: WebDiscoveredItem[] = []

  for (const p of results) {
    const img = p.urls?.regular ?? p.urls?.small
    if (!img || !p.id) continue
    if (seen.has(p.id)) continue
    seen.add(p.id)

    const title =
      (p.alt_description ?? p.description ?? "Fashion look").trim().slice(0, 180) || "Fashion look"

    out.push({
      image_url: img,
      title,
      /** Placeholder — vision + Gemini fill real kebab tags in `persistWebDiscoverCandidates`. */
      style_tags: ["unsplash-source"],
    })
  }

  return out
}
