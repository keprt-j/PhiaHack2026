/**
 * Heuristics for “live” shopping navigation vs. dead retailer URLs.
 * Google Search / Shopping URLs are treated as always current (SERP refreshes).
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/** URLs that point at a search engine (results update; no single stale SKU). */
export function isSearchEngineShoppingUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    if (host === "google.com" || host.endsWith(".google.com")) return true
    /** Lens opens image-first product matches from a public image URL — no stale PDP. */
    if (host === "lens.google.com") return true
    if (host === "bing.com" || host.endsWith(".bing.com")) {
      return u.pathname.includes("/shop") || u.searchParams.has("q")
    }
    return false
  } catch {
    return false
  }
}

function stripNoiseParams(url: URL): void {
  url.hash = ""
  for (const k of [...url.searchParams.keys()]) {
    if (k.startsWith("utm_") || k === "gclid" || k === "fbclid") url.searchParams.delete(k)
  }
}

/** Stable key for deduping same destination with different tracking params. */
export function normalizeShoppingUrlKey(url: string): string {
  try {
    const u = new URL(url.trim())
    stripNoiseParams(u)
    return u.toString()
  } catch {
    return url.trim()
  }
}

/**
 * Returns false only when we get a clear HTTP “gone” signal (404/410) or explicit 5xx.
 * 403/timeout: keep — many shops block datacenter fetches but work in a real browser.
 */
export async function retailerUrlLooksAlive(url: string): Promise<boolean> {
  if (isSearchEngineShoppingUrl(url)) return true

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": BROWSER_UA,
      },
    })
    clearTimeout(timer)
    /** Avoid buffering full HTML — status + headers are enough to detect hard 404s. */
    if (res.body) {
      try {
        await res.body.cancel()
      } catch {
        /* noop */
      }
    }
    if (res.status === 404 || res.status === 410) return false
    if (res.status >= 500 && res.status < 600) return false
    return true
  } catch {
    /** Network / abort — do not assume dead; user may still open in browser. */
    return true
  }
}
