"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import Image from "next/image"
import Link from "next/link"
import { SwipeCard, SwipeButtons } from "./swipe-card"
import { MobileAppFrame } from "./mobile-app-frame"
import { HubBottomNav } from "./hub-bottom-nav"
import type { Outfit } from "@/lib/types"
import { isLikelyRawImageUrl, type ShopPick } from "@/lib/item-swipe/cluster-and-shop"
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Search,
  ShoppingBag,
  Sparkles,
} from "lucide-react"

const ITEM_SESSION_KEY = "phia.item.swipe.session"

function isSafeHttpUrl(u: string | null | undefined): boolean {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim())
}

type Phase = "compose" | "loading" | "swiping" | "summary"

export function ItemSwipeDiscovery({
  userId,
  guestSessionId: initialGuest,
  onDeckCompleted,
}: {
  userId: string | null
  guestSessionId?: string | null
  /** Called when a round finishes and the summary screen is shown (signed-in users use this for onboarding). */
  onDeckCompleted?: () => void | Promise<void>
}) {
  const [phase, setPhase] = useState<Phase>("compose")
  const [queryInput, setQueryInput] = useState("")
  const [activeQuery, setActiveQuery] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guestSessionId, setGuestSessionId] = useState<string | null>(initialGuest ?? null)
  const [queue, setQueue] = useState<Outfit[]>([])
  const [swipeCount, setSwipeCount] = useState(0)
  /** `0` means unlimited (item sessions). */
  const [targetCount, setTargetCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [initialDeckLoaded, setInitialDeckLoaded] = useState(false)
  const [swipeExitDirection, setSwipeExitDirection] = useState<"left" | "right" | "super">("right")
  const swipeInFlight = useRef(false)
  const [likedShortlist, setLikedShortlist] = useState<Outfit[]>([])
  const [shopPicks, setShopPicks] = useState<ShopPick[]>([])
  const [fallbackShopUrl, setFallbackShopUrl] = useState<string | null>(null)

  const refillDeck = useCallback(async () => {
    if (!sessionId) return
    setError(null)
    try {
      const res = await fetch("/api/swipes/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          guestSessionId: userId ? undefined : guestSessionId ?? undefined,
          itemSearchQuery: activeQuery || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not reload deck")
      const cards = data.cards || []
      if (!cards.length) {
        setError("No more looks for this search — try different words.")
        return
      }
      setQueue(cards)
      if (typeof data.swipeCount === "number") setSwipeCount(data.swipeCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reload deck")
    }
  }, [sessionId, guestSessionId, userId, activeQuery])

  useEffect(() => {
    if (queue.length > 0 || !sessionId || phase !== "swiping" || !initialDeckLoaded || error) return
    void refillDeck()
  }, [queue.length, sessionId, phase, initialDeckLoaded, error, refillDeck])

  const startSession = useCallback(async () => {
    const q = queryInput.trim()
    if (!q) return
    setError(null)
    setPhase("loading")
    setInitialDeckLoaded(false)
    try {
      const res = await fetch("/api/swipes/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemSearchQuery: q,
          guestSessionId: userId ? undefined : guestSessionId ?? undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not start")

      setSessionId(data.sessionId)
      if (data.guestSessionId) setGuestSessionId(data.guestSessionId)
      setActiveQuery(q)
      setSwipeCount(typeof data.swipeCount === "number" ? data.swipeCount : 0)
      const tc = typeof data.targetCount === "number" ? data.targetCount : 0
      setTargetCount(tc)
      setQueue(data.cards || [])
      if (!(data.cards || []).length) {
        setError("No looks matched that search yet — try broader words.")
        setPhase("compose")
        return
      }
      setPhase("swiping")
      setInitialDeckLoaded(true)
      try {
        localStorage.setItem(
          ITEM_SESSION_KEY,
          JSON.stringify({ sessionId: data.sessionId, query: q, userId }),
        )
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start")
      setPhase("compose")
    }
  }, [queryInput, guestSessionId, userId])

  const loadSummary = useCallback(async (sid: string) => {
    const res = await fetch(`/api/item-swipes/summary?sessionId=${encodeURIComponent(sid)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Summary failed")
    setLikedShortlist(data.liked ?? [])
    setShopPicks(Array.isArray(data.shopPicks) ? data.shopPicks : [])
    setFallbackShopUrl(typeof data.fallbackShopUrl === "string" ? data.fallbackShopUrl : null)
    setPhase("summary")
    await onDeckCompleted?.()
  }, [onDeckCompleted])

  const handleDone = useCallback(async () => {
    if (!sessionId) return
    try {
      await fetch("/api/item-swipes/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
      await loadSummary(sessionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish")
    }
  }, [sessionId, loadSummary])

  const handleSwipe = useCallback(
    (direction: "left" | "right" | "super") => {
      const top = queue[0]
      if (!top || !sessionId || phase !== "swiping") return false
      if (swipeInFlight.current) return false

      const position = swipeCount + 1
      const excludeCandidateIds = queue.slice(1).map((item) => item.id)
      const prevQueue = queue
      const prevCount = swipeCount

      swipeInFlight.current = true
      setSwipeExitDirection(direction)
      setSwipeCount((c) => c + 1)
      setQueue((q) => (q.length ? q.slice(1) : q))

      void (async () => {
        try {
          const res = await fetch("/api/swipes/event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              candidateId: top.id,
              direction,
              position,
              guestSessionId: userId ? undefined : guestSessionId ?? undefined,
              excludeCandidateIds,
            }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || "Swipe failed")

          const nextCount = typeof data.swipeCount === "number" ? data.swipeCount : position
          setSwipeCount(nextCount)
          setQueue((q) => {
            const rest = [...q]
            if (data.nextCard && !rest.some((item) => item.id === data.nextCard.id)) {
              rest.push(data.nextCard)
            }
            return rest
          })

          if (data.done) {
            await loadSummary(sessionId)
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Swipe failed")
          setSwipeCount(prevCount)
          setQueue(prevQueue)
        } finally {
          swipeInFlight.current = false
        }
      })()
      return true
    },
    [queue, sessionId, phase, swipeCount, guestSessionId, userId, loadSummary],
  )

  const handleChain = useCallback(() => {
    setPhase("compose")
    setQueryInput("")
    setActiveQuery("")
    setSessionId(null)
    setQueue([])
    setSwipeCount(0)
    setTargetCount(0)
    setError(null)
    setInitialDeckLoaded(false)
    setLikedShortlist([])
    setShopPicks([])
    setFallbackShopUrl(null)
    try {
      localStorage.removeItem(ITEM_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const isUnlimited = targetCount <= 0
  const currentOutfit = queue[0]
  const nextOutfit = queue[1]

  if (phase === "compose") {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col justify-center px-5 py-10">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Search className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">Find a piece</h1>
                <p className="text-sm text-muted-foreground">
                  Name the exact piece (color + garment), e.g. &ldquo;black dress shirt&rdquo; or &ldquo;black
                  Chelsea boots&rdquo;. We match looks where that item reads clearly, then you can shortlist and
                  shop similar.
                </p>
              </div>
            </div>
            <label className="sr-only" htmlFor="item-query">
              Item search
            </label>
            <input
              id="item-query"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void startSession()
              }}
              placeholder="e.g. white wide-leg pants, black oxford shirt"
              className="glass-well mb-4 w-full rounded-2xl border border-white/30 bg-background/80 px-4 py-3 text-base text-foreground shadow-inner placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent dark:border-white/10"
              autoComplete="off"
              autoFocus
            />
            {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={!queryInput.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
            >
              Start swiping
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
        <HubBottomNav />
      </MobileAppFrame>
    )
  }

  if (phase === "loading") {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-center text-muted-foreground">
            Finding photos that match your search — this can take a little while…
          </p>
        </div>
        <HubBottomNav />
      </MobileAppFrame>
    )
  }

  if (phase === "summary") {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-8 pb-24">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-lg">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Check className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Your shortlist</h2>
              <p className="mt-1 truncate px-2 text-sm text-muted-foreground" title={activeQuery}>
                {activeQuery}
              </p>
            </div>

            {likedShortlist.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                No saves this round — try swiping right on looks you&apos;d actually wear.
              </p>
            ) : (
              <>
                {shopPicks.length > 0 ? (
                  <div className="mb-8">
                    <ul className="space-y-3">
                      {shopPicks.map((pick, i) => (
                        <li key={`${pick.googleShopUrl}-${i}`}>
                          <div className="glass-card overflow-hidden rounded-2xl p-2.5">
                            <div className="flex gap-2.5">
                              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                                <Image
                                  src={pick.thumbnailUrl}
                                  alt=""
                                  fill
                                  className="object-cover"
                                  unoptimized
                                />
                              </div>
                              <div className="min-w-0 flex-1 py-0.5">
                                <p
                                  className="truncate text-[13px] font-semibold text-foreground"
                                  title={pick.label}
                                >
                                  {pick.label}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2.5 flex flex-col gap-1.5">
                              {pick.retailerUrl ? (
                                <>
                                  <a
                                    href={pick.retailerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Shop"
                                    aria-label="Open retailer"
                                    className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90"
                                  >
                                    <ShoppingBag className="h-4 w-4" />
                                  </a>
                                  <a
                                    href={pick.googleShopUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Google Shopping"
                                    aria-label="Google Shopping"
                                    className="inline-flex h-8 w-full items-center justify-center rounded-xl border border-border/80 bg-muted/20 text-muted-foreground hover:bg-secondary/60"
                                  >
                                    <Search className="h-3.5 w-3.5" />
                                  </a>
                                </>
                              ) : (
                                <a
                                  href={pick.googleShopUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Google Shopping"
                                  aria-label="Google Shopping"
                                  className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90"
                                >
                                  <Search className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {fallbackShopUrl && shopPicks.length === 0 ? (
                  <a
                    href={fallbackShopUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Google Shopping"
                    aria-label="Google Shopping"
                    className="mb-6 flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-foreground hover:bg-secondary"
                  >
                    <Search className="h-5 w-5 text-muted-foreground" />
                  </a>
                ) : null}

                <div>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Saved looks
                  </h3>
                  <ul className="space-y-3">
                    {likedShortlist.map((o) => (
                      <li key={o.id} className="glass-card flex gap-3 overflow-hidden rounded-2xl p-3">
                        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                          <Image src={o.image_url} alt={o.title} fill className="object-cover" unoptimized />
                        </div>
                        <div className="min-w-0 flex-1 py-0.5">
                          <p className="line-clamp-2 text-sm font-medium text-foreground">{o.title}</p>
                          {o.brand ? <p className="mt-0.5 text-xs text-muted-foreground">{o.brand}</p> : null}
                          {isSafeHttpUrl(o.source_url) ? (
                            <a
                              href={o.source_url!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                            >
                              {isLikelyRawImageUrl(o.source_url!) ? "View original photo" : "Open link"}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={handleChain}
              className="mx-auto mt-8 flex w-full max-w-sm items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Find another item
            </button>
            <Link
              href="/feed"
              className="mt-4 block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Back to feed
            </Link>
          </motion.div>
        </div>
        <HubBottomNav />
      </MobileAppFrame>
    )
  }

  const showRefill = initialDeckLoaded && phase === "swiping" && queue.length === 0 && sessionId && !error
  if (showRefill) {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading more looks…</p>
        </div>
        <HubBottomNav />
      </MobileAppFrame>
    )
  }

  return (
    <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative z-20 flex w-full shrink-0 items-center px-3 pb-2 pt-[max(0.25rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => void handleDone()}
            disabled={swipeInFlight.current}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80"
          >
            Exit
          </button>
          <span className="min-w-0 flex-1" />
          {swipeCount > 0 ? (
            <span className="shrink-0 tabular-nums text-[11px] font-medium text-muted-foreground">
              {swipeCount} swiped
            </span>
          ) : null}
        </div>

        {!isUnlimited ? (
          <div className="relative z-[1] shrink-0 px-3 pb-2">
            <div className="h-0.5 overflow-hidden rounded-full bg-secondary shadow-inner">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-accent/90 to-accent"
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.min((swipeCount / Math.max(targetCount, 1)) * 100, 100)}%`,
                }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        ) : null}

        {error && queue.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <p className="text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setPhase("compose")
              }}
              className="mt-4 text-sm font-medium text-accent"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-2 pt-0">
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center pb-1">
                <div className="relative mx-auto aspect-[3/5] w-full max-w-[min(16.75rem,calc(100%-1.25rem))] max-h-[min(52vh,26rem)] min-h-0">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {nextOutfit && (
                      <SwipeCard
                        key={nextOutfit.id}
                        outfit={nextOutfit}
                        onSwipe={() => false}
                        isTop={false}
                        commitDirection={swipeExitDirection}
                      />
                    )}
                    {currentOutfit && (
                      <SwipeCard
                        key={currentOutfit.id}
                        outfit={currentOutfit}
                        onSwipe={handleSwipe}
                        isTop={true}
                        commitDirection={swipeExitDirection}
                      />
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="shrink-0 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
                <SwipeButtons onSwipe={handleSwipe} variant="bar" />
              </div>
            </div>
          </>
        )}
      </div>
      <HubBottomNav />
    </MobileAppFrame>
  )
}
