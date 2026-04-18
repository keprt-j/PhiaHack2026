/** Server-side only — used from API routes / ingest. */

import { createHash } from "crypto"

const MAX_BYTES = 4 * 1024 * 1024
/** Modern Chrome on macOS — needed because Pinterest, Vogue, GQ, etc. block bot UAs. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

function guessMimeFromUrl(url: string): string {
  const u = url.toLowerCase()
  if (u.includes(".png")) return "image/png"
  if (u.includes(".webp")) return "image/webp"
  if (u.includes(".gif")) return "image/gif"
  return "image/jpeg"
}

/**
 * Many image CDNs hotlink-block requests with no/foreign Referer. Sending the parent site
 * as Referer is the standard workaround used by every browser and image proxy.
 */
function refererForHost(host: string): string | undefined {
  const h = host.toLowerCase()
  if (h.endsWith("pinimg.com")) return "https://www.pinterest.com/"
  if (h.endsWith("pinterest.com")) return "https://www.pinterest.com/"
  if (h.includes("vogue.com")) return "https://www.vogue.com/"
  if (h.includes("gq.com")) return "https://www.gq.com/"
  if (h.includes("harpersbazaar")) return "https://www.harpersbazaar.com/"
  if (h.includes("whowhatwear")) return "https://www.whowhatwear.com/"
  if (h.includes("instagram") || h.includes("cdninstagram") || h.includes("fbcdn"))
    return "https://www.instagram.com/"
  if (h.endsWith("unsplash.com")) return "https://unsplash.com/"
  if (h.endsWith("pexels.com")) return "https://www.pexels.com/"
  return undefined
}

/**
 * Normalize an image URL so visually-identical images served with different query strings
 * (Unsplash `?w=800&h=1200` vs `?q=80&auto=format`) collapse to the same key.
 */
export function normalizeImageUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    const stripQueryHosts = [
      "images.unsplash.com",
      "images.pexels.com",
      "i.pinimg.com",
      "cdn.shopify.com",
      "media.gq.com",
      "assets.vogue.com",
      "media.vogue.com",
      "static.zara.net",
      "lp2.hm.com",
      "image.uniqlo.com",
      "media.glamour.com",
      "cdn-images.farfetch-contents.com",
    ]
    const drop = stripQueryHosts.some((h) => host === h || host.endsWith(`.${h}`))
    const search = drop ? "" : u.search
    return `${u.protocol}//${host}${u.pathname.replace(/\/+$/, "")}${search}`
  } catch {
    return url.trim()
  }
}

export type FetchedImage = {
  mimeType: string
  data: string
  /** Hex sha256 of the raw image bytes — stable across URL/CDN/query changes. */
  sha256: string
  byteLength: number
  /** May differ from the input URL if we followed an og:image fallback. */
  resolvedUrl: string
}

export type FetchFailReason =
  | "bad-url"
  | "non-http"
  | "status"
  | "empty"
  | "too-large"
  | "wrong-mime"
  | "abort"
  | "network"
  | "html-no-og-image"

/** Verbose diagnostics — `[image-fetch] FAIL host status reason url` per failure when enabled. */
const VERBOSE = process.env.IMAGE_FETCH_VERBOSE === "1"

function logFail(url: string, reason: FetchFailReason, detail?: string | number) {
  if (!VERBOSE) return
  let host = "?"
  try {
    host = new URL(url).hostname
  } catch {
    /* noop */
  }
  console.warn(`[image-fetch] FAIL ${host} ${reason}${detail !== undefined ? ` (${detail})` : ""} ${url}`)
}

function looksLikeDirectImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url)
}

function buildHeaders(parsed: URL, opts?: { imageLike?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": BROWSER_UA,
  }
  const ref = refererForHost(parsed.hostname)
  if (ref) headers.Referer = ref
  /** Helps some CDNs serve bytes instead of an anti-bot interstitial. */
  if (opts?.imageLike) {
    headers["Sec-Fetch-Dest"] = "image"
    headers["Sec-Fetch-Mode"] = "no-cors"
    headers["Sec-Fetch-Site"] = "cross-site"
  }
  return headers
}

/**
 * Extract the largest-looking image URL from an HTML page's open-graph / twitter meta tags.
 * We deliberately keep this dumb-string-search simple — no DOM parser dep, no full-page fetch
 * beyond the head section we've already read.
 */
function extractOgImage(html: string, base: string): string | null {
  /** Limit search to the head — avoids matching og:image inside post comments etc. */
  const head = html.slice(0, 50_000)
  const candidates = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ]
  for (const re of candidates) {
    const m = head.match(re)
    if (m?.[1]) {
      try {
        return new URL(m[1], base).toString()
      } catch {
        /* try next */
      }
    }
  }
  return null
}

/**
 * Internal single-shot fetch. Returns image bytes OR an HTML body to feed into og:image extraction.
 */
async function rawFetch(url: string): Promise<
  | { kind: "image"; mime: string; buf: Buffer }
  | { kind: "html"; body: string }
  | { kind: "fail"; reason: FetchFailReason; detail?: string | number }
> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: "fail", reason: "bad-url" }
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { kind: "fail", reason: "non-http" }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 18_000)
  const imageLike = looksLikeDirectImageUrl(url)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: buildHeaders(parsed, { imageLike }),
    })
    if (!res.ok) return { kind: "fail", reason: "status", detail: res.status }
    const ct = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return { kind: "fail", reason: "empty" }

    if (ct.startsWith("image/")) {
      if (buf.length > MAX_BYTES) return { kind: "fail", reason: "too-large", detail: buf.length }
      return { kind: "image", mime: ct, buf }
    }
    if (ct.startsWith("text/html")) {
      /** Decode as utf-8 — meta tags are always ASCII-safe even on non-utf8 pages. */
      return { kind: "html", body: buf.toString("utf8") }
    }
    /** Some CDNs lie about content-type. If the URL clearly looks like an image, accept the bytes. */
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
      if (buf.length > MAX_BYTES) return { kind: "fail", reason: "too-large", detail: buf.length }
      return { kind: "image", mime: guessMimeFromUrl(url), buf }
    }
    return { kind: "fail", reason: "wrong-mime", detail: ct || "unknown" }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { kind: "fail", reason: "abort" }
    return { kind: "fail", reason: "network", detail: (e as Error)?.message?.slice(0, 80) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch remote image for Gemini vision. If the URL is an HTML page (which Gemini Search frequently
 * returns instead of a direct image), follow `og:image` once. Returns null on failure.
 */
export async function fetchImageAsInlineData(url: string): Promise<FetchedImage | null> {
  const first = await rawFetch(url)

  if (first.kind === "fail") {
    logFail(url, first.reason, first.detail)
    return null
  }

  let mime: string
  let buf: Buffer
  let resolvedUrl = url

  if (first.kind === "image") {
    mime = first.mime
    buf = first.buf
  } else {
    /** Gemini returned a page (Pinterest pin, Vogue article, retailer PLP). Pull og:image and refetch. */
    const og = extractOgImage(first.body, url)
    if (!og) {
      logFail(url, "html-no-og-image")
      return null
    }
    const second = await rawFetch(og)
    if (second.kind === "fail") {
      logFail(og, second.reason, second.detail)
      return null
    }
    if (second.kind !== "image") {
      logFail(og, "wrong-mime", "og-image-not-image")
      return null
    }
    mime = second.mime
    buf = second.buf
    resolvedUrl = og
  }

  if (!mime.startsWith("image/")) {
    logFail(resolvedUrl, "wrong-mime", mime)
    return null
  }
  const sha256 = createHash("sha256").update(buf).digest("hex")
  return { mimeType: mime, data: buf.toString("base64"), sha256, byteLength: buf.length, resolvedUrl }
}
