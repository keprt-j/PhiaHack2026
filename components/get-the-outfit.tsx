"use client"

import { useCallback, useState } from "react"
import { ExternalLink, Loader2, ShoppingBag, Sparkles } from "lucide-react"

type ShopLink = {
  title: string
  url: string
  piece_label?: string
  match?: "similar" | "exact" | "unknown"
  retailer?: string
}

type Piece = {
  label: string
  item_type?: string
  search_query?: string
}

type ApiOk = {
  source: "search+vision" | "vision+fallback"
  summary: string
  pieces: Piece[]
  links: ShopLink[]
}

function isLiveSearchNavUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    if (h === "lens.google.com") return true
    if (h === "google.com" || h.endsWith(".google.com")) return true
    if ((h === "bing.com" || h.endsWith(".bing.com")) && (u.pathname.includes("/shop") || u.searchParams.has("q")))
      return true
    return false
  } catch {
    return false
  }
}

function LinkList({ links }: { links: ShopLink[] }) {
  return (
    <ul className="space-y-2">
      {links.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-border hover:bg-muted/50"
          >
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground group-hover:underline">{link.title}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {link.retailer ? <span>{link.retailer}</span> : null}
                {link.piece_label ? <span>· {link.piece_label}</span> : null}
                {link.match === "similar" ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Similar</span>
                ) : null}
                {link.match === "exact" ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Match</span>
                ) : null}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

export function GetTheOutfit({ postId, hasImage }: { postId: string; hasImage: boolean }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ApiOk | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/posts/outfit-shopping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      })
      const json = (await res.json()) as ApiOk & { error?: string }
      if (!res.ok) {
        setError(json.error ?? "Something went wrong")
        setData(null)
        return
      }
      setData(json)
    } catch {
      setError("Network error — try again.")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [postId])

  if (!hasImage) {
    return (
      <div className="rounded-2xl border border-border bg-muted/30 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">Add a photo to this post to get shopping ideas for the look.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <ShoppingBag className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">Get the outfit</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI names the pieces, then opens live product search and vetted store pages so listings stay current.
          </p>
        </div>
      </div>

      {!data && (
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Finding pieces…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Find pieces &amp; links
            </>
          )}
        </button>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {data && (
        <div className="space-y-4 pt-1">
          <p className="text-sm leading-relaxed text-foreground">{data.summary}</p>

          {data.pieces.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pieces</p>
              <ul className="flex flex-wrap gap-2">
                {data.pieces.map((p) => (
                  <li
                    key={p.label}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground"
                  >
                    {p.label}
                    {p.item_type ? (
                      <span className="text-muted-foreground"> · {p.item_type}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.links.length > 0 && (() => {
            const liveNav = data.links.filter((l) => isLiveSearchNavUrl(l.url))
            const storeNav = data.links.filter((l) => !isLiveSearchNavUrl(l.url))
            return (
              <div className="space-y-5">
                {liveNav.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Image-first shopping
                    </p>
                    <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                      Google Lens opens with your outfit photo and each piece’s search terms, so you see product cards with
                      images (not just a text Shopping list). Plain Google Shopping links appear when the image URL is too
                      long for Lens.
                    </p>
                    <LinkList links={liveNav} />
                  </div>
                ) : null}
                {storeNav.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Store &amp; marketplace pages
                    </p>
                    <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                      From web search; obvious broken pages are filtered when possible — stock still changes daily.
                    </p>
                    <LinkList links={storeNav} />
                  </div>
                ) : null}
              </div>
            )
          })()}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Individual product URLs go stale quickly; live Google Shopping searches and current-season category pages are
            more reliable than old blog links. Always confirm price and availability on the retailer.
          </p>

          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh suggestions"}
          </button>
        </div>
      )}
    </div>
  )
}
