import type { createServiceClient } from "@/lib/supabase/admin"
import {
  discoverOutfitImagesFromWeb,
  type DiscoverOpts,
  type WebDiscoveredItem,
} from "@/lib/ai/gemini-web-images"
import { discoverOutfitPhotosFromUnsplash } from "@/lib/ai/unsplash-discover"
import { enrichOutfitCardBriefFromVision } from "@/lib/ai/gemini"
import { fetchImageAsInlineData, normalizeImageUrl, type FetchedImage } from "@/lib/ai/image-fetch"
import { mapWithConcurrency } from "@/lib/util/concurrency"
import {
  buildWeightsFromSignals,
  topNegativeTags,
  topPositiveTags,
  type SwipeSignal,
} from "@/lib/ranking/next-candidate"
import { getDevGoogleSearchDisabled } from "@/lib/dev/google-search-flag"

type Admin = ReturnType<typeof createServiceClient>

type Counters = {
  inserted: number
  fetchFail: number
  /** Vision said not a full adult outfit (or child / flat-lay / etc.). */
  skippedNotOutfit: number
  /** Outfit ok but composition not suitable for segmentation / export pipelines. */
  skippedNotPipelineReady: number
  /** No passing vision result (API/parse failure, or ambiguous — not inserted). */
  skippedNoPassingVision: number
}

const newCounters = (): Counters => ({
  inserted: 0,
  fetchFail: 0,
  skippedNotOutfit: 0,
  skippedNotPipelineReady: 0,
  skippedNoPassingVision: 0,
})

function logCounters(c: Counters) {
  if (c.fetchFail) console.log("[web-discover] skipped", c.fetchFail, "fetch failures")
  if (c.skippedNotOutfit) console.log("[web-discover] skipped", c.skippedNotOutfit, "images (not adult full outfit)")
  if (c.skippedNotPipelineReady)
    console.log("[web-discover] skipped", c.skippedNotPipelineReady, "images (not pipeline-ready for export/vector)")
  if (c.skippedNoPassingVision) console.log("[web-discover] skipped", c.skippedNoPassingVision, "rows (vision gate / no valid brief)")
}

type Staged = { it: WebDiscoveredItem; rawUrl: string; normUrl: string }
type Fetched = Staged & { fetched: FetchedImage }
type Enriched = Fetched & {
  card_title: string
  card_description: string
  /** Kebab tags from Gemini vision (preferred over Unsplash placeholder tags). */
  gemini_style_tags?: string[]
}

function stageAll(items: WebDiscoveredItem[]): Staged[] {
  const seen = new Set<string>()
  const out: Staged[] = []
  for (const it of items) {
    const rawUrl = it.image_url.trim()
    const normUrl = normalizeImageUrl(rawUrl)
    if (seen.has(normUrl)) continue
    seen.add(normUrl)
    out.push({ it, rawUrl, normUrl })
  }
  return out
}

/** Avoid re-inserting the same Unsplash/Gemini image URL already in the catalog. */
async function filterUrlsNotAlreadyInDb(admin: Admin, rows: Staged[]): Promise<Staged[]> {
  if (!rows.length) return []
  const urls = [...new Set(rows.map((r) => r.normUrl))]
  const { data, error } = await admin.from("outfit_candidates").select("image_url").in("image_url", urls)
  if (error) {
    console.warn("[web-discover] existing-url check failed", error.message)
    return rows
  }
  const have = new Set((data ?? []).map((r) => r.image_url as string))
  return rows.filter((r) => !have.has(r.normUrl))
}

async function fetchAll(items: Staged[], counters: Counters): Promise<Fetched[]> {
  const results = await mapWithConcurrency(items, 4, async (row) => {
    const img = await fetchImageAsInlineData(row.rawUrl)
    return img ? ({ ...row, fetched: img } as Fetched) : null
  })
  const ok: Fetched[] = []
  for (const r of results) {
    if (!r) counters.fetchFail++
    else ok.push(r)
  }
  return ok
}

/** Rows pass when vision says full outfit + pipeline_ready (export / segmentation friendly). */
async function enrichWithBriefVision(items: Fetched[], counters: Counters): Promise<Enriched[]> {
  const results = await mapWithConcurrency(items, 3, async (row): Promise<Enriched | null> => {
    try {
      const vision = await enrichOutfitCardBriefFromVision({
        inline: { mimeType: row.fetched.mimeType, data: row.fetched.data },
      })
      if (vision && vision.is_outfit === false) {
        counters.skippedNotOutfit++
        return null
      }
      if (vision && vision.is_outfit === true && vision.pipeline_ready === false) {
        counters.skippedNotPipelineReady++
        return null
      }
      if (
        vision?.is_outfit === true &&
        vision.pipeline_ready === true &&
        vision.card_title.trim().length > 0 &&
        vision.card_description.trim().length > 0
      ) {
        return {
          ...row,
          card_title: vision.card_title.trim().slice(0, 60),
          card_description: vision.card_description.trim().slice(0, 180),
          gemini_style_tags: vision.style_tags?.length ? vision.style_tags : undefined,
        }
      }
    } catch (e) {
      console.warn("[web-discover] vision brief failed", e instanceof Error ? e.message : e)
    }
    counters.skippedNoPassingVision++
    return null
  })
  return results.filter((r): r is Enriched => r != null)
}

async function insertOne(admin: Admin, row: Enriched): Promise<{ ok: true } | { ok: false; code?: string; msg: string }> {
  const title = row.card_title
  const description = row.card_description
  const seedTags = row.it.style_tags.filter((t) => t !== "unsplash-source")
  const gemini = row.gemini_style_tags ?? []
  const merged = gemini.length ? gemini : seedTags.length ? seedTags : ["discovered"]
  const tags = [...new Set([...merged, "web", "full-look", "export-ready"])].slice(0, 16)

  const via =
    row.rawUrl.includes("images.unsplash.com") || row.rawUrl.includes("plus.unsplash.com")
      ? "unsplash_api"
      : "gemini_google_search"

  /** Real fetchable URL so “View original” / tabs work — not a `web-gemini:` placeholder. */
  const sourceUrl =
    row.rawUrl.trim().startsWith("http") ? row.rawUrl.trim() : `https://${row.rawUrl.trim().replace(/^\/\//, "")}`

  const { error } = await admin.from("outfit_candidates").insert({
    title,
    description,
    image_url: row.normUrl,
    brand_name: null,
    price_range: null,
    style_tags: tags,
    category: "casual",
    source_url: sourceUrl,
    source_type: "web_gemini",
    source_platform: "web",
    source_context: {
      via,
      image_origin: row.rawUrl,
      pipeline_ready: true,
      integration_hints: ["segmentation", "embeddings", "lookbook"],
    },
    image_hash: row.fetched.sha256,
    freshness_score: 2.5,
    is_trending: true,
  })
  if (error) return { ok: false, code: error.code, msg: error.message }
  return { ok: true }
}

export async function persistWebDiscoverCandidates(admin: Admin, items: WebDiscoveredItem[]): Promise<number> {
  const c = newCounters()

  const staged = await filterUrlsNotAlreadyInDb(admin, stageAll(items))
  const fetched = await fetchAll(staged, c)
  const enriched = await enrichWithBriefVision(fetched, c)

  let loggedSample = false
  for (const row of enriched) {
    const res = await insertOne(admin, row)
    if (res.ok) {
      c.inserted++
    } else if (!loggedSample) {
      console.warn("[web-discover] insert error (sample)", res.code, res.msg)
      loggedSample = true
    }
  }

  logCounters(c)
  return c.inserted
}

export type KickOffOpts = {
  styleTags?: string[]
  dislikeTags?: string[]
  brief?: string
  query?: string
  targetInserts?: number
  maxAttempts?: number
}

function buildTheme(opts: KickOffOpts): string {
  if (opts.query?.trim()) return opts.query.trim()
  const likes = (opts.styleTags ?? []).filter(Boolean).slice(0, 8)
  const avoid = (opts.dislikeTags ?? []).filter(Boolean).slice(0, 8)
  let base: string
  if (likes.length) {
    base = `single subject adult street-style and editorial photo, one person wearing a coordinated ${likes.join(", ")} outfit, full body or three-quarter, uncluttered composition, clear figure for cutout or stylization, mature model, 2026`
  } else {
    base =
      process.env.WEB_DISCOVER_QUERY?.trim() ||
      "editorial street-style photographs of adults in full coordinated outfits, one clear subject per frame, full body or three-quarter, simple or contrasting backgrounds, suitable for silhouette and product-adjacent APIs, 2026"
  }
  if (avoid.length) base = `${base} (avoid styles: ${avoid.join(", ")})`
  return base
}

/** Maps swipe signals into Unsplash / discover theme hints (likes + dislikes from ranking weights). */
export function discoverKickOptsFromSignals(signals: SwipeSignal[]): KickOffOpts {
  const { tagWeights } = buildWeightsFromSignals(signals)
  return {
    styleTags: topPositiveTags(tagWeights, 10),
    dislikeTags: topNegativeTags(tagWeights, 8),
  }
}

export async function kickOffWebDiscover(admin: Admin, opts: KickOffOpts): Promise<void> {
  if (process.env.GEMINI_WEB_DISCOVER === "0") return

  const theme = buildTheme(opts)
  const source = (process.env.WEB_DISCOVER_SOURCE ?? "unsplash").toLowerCase()
  const unsplashCount = Number(process.env.WEB_DISCOVER_UNSPLASH_COUNT ?? "15")
  const itemSearch = Boolean(opts.query?.trim())
  const perPage = itemSearch ? Math.max(unsplashCount, 22) : unsplashCount

  let found: WebDiscoveredItem[] = []

  /**
   * Typed item searches need Google-backed image discovery; Unsplash keyword search alone
   * often misses color + garment combos. Try Gemini first when the global source is Unsplash.
   */
  if (
    itemSearch &&
    source !== "gemini_search" &&
    process.env.ITEM_DISCOVER_GEMINI_FIRST !== "0" &&
    process.env.GEMINI_API_KEY &&
    !getDevGoogleSearchDisabled()
  ) {
    found = await discoverOutfitImagesFromWeb(theme, {})
    if (found.length) {
      const inserted = await persistWebDiscoverCandidates(admin, found)
      console.log(`[web-discover] item Gemini-first inserted ${inserted} of ${found.length}`)
      if (inserted > 0) return
    }
  }

  if (source === "gemini_search") {
    const discoverOpts: DiscoverOpts = {}
    found = await discoverOutfitImagesFromWeb(theme, discoverOpts)
  } else {
    found = await discoverOutfitPhotosFromUnsplash(theme, { perPage })
    if (!found.length && process.env.WEB_DISCOVER_FALLBACK_GEMINI === "1") {
      if (getDevGoogleSearchDisabled()) {
        console.warn("[web-discover] Unsplash empty; Gemini Search fallback skipped (dev toggle)")
      } else {
        console.warn("[web-discover] Unsplash empty, falling back to Gemini Search")
        found = await discoverOutfitImagesFromWeb(theme, {})
      }
    }
  }

  if (!found.length) {
    console.warn("[web-discover] kick returned 0 candidates, source:", source, "theme:", theme.slice(0, 120))
    return
  }
  const inserted = await persistWebDiscoverCandidates(admin, found)
  console.log(`[web-discover] inserted ${inserted} of ${found.length} (${source}), theme: ${theme.slice(0, 120)}`)
}
