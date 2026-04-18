"use client"

import { useState, useCallback, useEffect, useRef, startTransition } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { SwipeCard, SwipeButtons } from "./swipe-card"
import { ProfileGeneratingSplash } from "./profile-generating-splash"
import { MobileAppFrame } from "./mobile-app-frame"
import { splitProfileIntoNotes, StyleProfileReveal } from "./style-notes"
import type { Community, Outfit, Post } from "@/lib/types"
import { Sparkles, ArrowRight, Loader2, RotateCcw, X, LogIn } from "lucide-react"

const TARGET_SWIPES = 12
const SESSION_STORAGE_KEY = "phia.swipe.session"

/** Dev only: pauses Gemini + Google Search for web image discovery (local server flag). */
function DevGoogleSearchToggle() {
  const [off, setOff] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void fetch("/api/dev/google-search")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { disabled?: boolean } | null) => {
        if (d && typeof d.disabled === "boolean") setOff(d.disabled)
      })
      .finally(() => setReady(true))
  }, [])

  const toggle = async () => {
    const res = await fetch("/api/dev/google-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: !off }),
    })
    const d = (await res.json()) as { disabled?: boolean }
    if (typeof d.disabled === "boolean") setOff(d.disabled)
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      className="fixed bottom-24 left-2 z-50 rounded-md border border-dashed border-amber-500/50 bg-background/95 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-secondary hover:text-foreground"
      title="Dev: when off, Gemini Google Search is skipped for outfit URL discovery (Unsplash unchanged)"
    >
      {ready ? (off ? "G search off" : "G search on") : "…"}
    </button>
  )
}

type StoredSession = { sessionId: string; guestSessionId?: string | null; userId: string | null }

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as StoredSession
    if (typeof v?.sessionId === "string") return v
  } catch {
    /* ignore corrupt storage */
  }
  return null
}

function writeStoredSession(v: StoredSession): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(v))
  } catch {
    /* quota / privacy mode — best effort */
  }
}

function clearStoredSession(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    /* best effort */
  }
}

export type ProfileHandoff = {
  /** Short label from Gemini, e.g. "Soft coastal minimal" */
  style_name?: string
  profile_prompt: string
  profileTags: string[]
  recommendedCommunities: Community[]
  initialFeedPosts: Post[]
  traits: Record<string, unknown>
  confidence: number
}

interface TasteDiscoveryProps {
  userId: string | null
  onComplete: (handoff: ProfileHandoff) => void
  unlimited?: boolean
  onExit?: () => void
}

type Phase = "loading" | "swiping" | "profileLoading" | "done"

export function TasteDiscovery({ userId, onComplete, unlimited = false, onExit }: TasteDiscoveryProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guestSessionId, setGuestSessionId] = useState<string | null>(null)
  const [queue, setQueue] = useState<Outfit[]>([])
  const [swipeCount, setSwipeCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [handoff, setHandoff] = useState<ProfileHandoff | null>(null)
  const [resetTick, setResetTick] = useState(0)
  /** After the first successful /api/swipes/session, never show the full-screen “Preparing deck” again (empty queue = refill, not bootstrap). */
  const [initialDeckLoaded, setInitialDeckLoaded] = useState(false)
  /** Drives AnimatePresence exit direction for the top card (must update before queue pops). */
  const [swipeExitDirection, setSwipeExitDirection] = useState<"left" | "right" | "super">("right")
  const swipeInFlight = useRef(false)
  const refreshedSwipeBatch = useRef(0)

  useEffect(() => {
    // Decode off the gesture path: next paint, not synchronously with drag updates.
    const urls = queue.slice(0, 2).map((item) => item.image_url)
    const id = requestAnimationFrame(() => {
      for (const url of urls) {
        const img = new Image()
        img.decoding = "async"
        img.src = url
      }
    })
    return () => cancelAnimationFrame(id)
  }, [queue])

  useEffect(() => {
    refreshedSwipeBatch.current = 0
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stored = readStoredSession()
        /** Only resume when storage matches current auth state to avoid attaching a guest deck to a logged-in user. */
        const usable = !resetTick && stored && stored.userId === userId ? stored : null

        const res = await fetch("/api/swipes/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: usable?.sessionId,
            guestSessionId: usable?.guestSessionId ?? undefined,
            unlimited,
            /** Bumped resetTick → user clicked Redo/Cancel → tell the server to close any open session. */
            reset: resetTick > 0,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Session failed")

        if (!cancelled) {
          setSessionId(data.sessionId)
          setGuestSessionId(data.guestSessionId ?? null)
          writeStoredSession({
            sessionId: data.sessionId,
            guestSessionId: data.guestSessionId ?? null,
            userId,
          })
          setSwipeCount(typeof data.swipeCount === "number" ? data.swipeCount : 0)
          setQueue(data.cards || [])
          setError((data.cards || []).length ? null : "No outfits in the deck right now — try again in a moment.")
          setPhase("swiping")
          setInitialDeckLoaded(true)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not start")
          setPhase("swiping")
        }
      }
    }
    start()
    return () => {
      cancelled = true
    }
  }, [userId, resetTick, unlimited])

  /** Wipes everything (local cache + server-side active session) and re-runs the start effect. */
  const handleDevDeleteCandidate = useCallback(async (candidateId: string) => {
    try {
      const res = await fetch(`/api/dev/candidate?id=${encodeURIComponent(candidateId)}`, {
        method: "DELETE",
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || "Delete failed")
      startTransition(() => {
        setQueue((q) => q.filter((o) => o.id !== candidateId))
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    }
  }, [])

  const handleReset = useCallback(() => {
    clearStoredSession()
    setHandoff(null)
    setError(null)
    setSwipeCount(0)
    setQueue([])
    setSessionId(null)
    setGuestSessionId(null)
    setPhase("loading")
    setInitialDeckLoaded(false)
    setResetTick((n) => n + 1)
  }, [])

  /** Mid-session: fresh pair of picks from the broad pool (same session). Also used by auto-refill. */
  const refillDeck = useCallback(async () => {
    if (!sessionId) return
    setError(null)
    try {
      const res = await fetch("/api/swipes/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          guestSessionId: guestSessionId ?? undefined,
          unlimited,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not reload deck")
      const cards = data.cards || []
      if (!cards.length) {
        setError("No more looks in the pool for this session — try Reset or refresh the page.")
        return
      }
      setQueue(cards)
      if (typeof data.swipeCount === "number") setSwipeCount(data.swipeCount)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reload deck")
    }
  }, [sessionId, guestSessionId, unlimited])

  useEffect(() => {
    if (queue.length > 0 || !sessionId || phase !== "swiping" || !initialDeckLoaded || error) return
    void refillDeck()
  }, [queue.length, sessionId, phase, initialDeckLoaded, error, refillDeck])

  const runSummarize = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch("/api/profile/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          guestSessionId: userId ? undefined : guestSessionId ?? undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Summary failed")

      const h: ProfileHandoff = {
        style_name: typeof data.profile?.style_name === "string" ? data.profile.style_name : undefined,
        profile_prompt: data.profile.profile_prompt,
        profileTags: data.profileTags ?? [],
        recommendedCommunities: data.recommendedCommunities ?? [],
        initialFeedPosts: data.initialFeedPosts ?? [],
        traits: data.profile.traits ?? {},
        confidence: data.profile.confidence ?? 0,
      }
      setHandoff(h)
      setPhase("done")
      clearStoredSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summary failed")
      setPhase("done")
      setHandoff({
        style_name: "Your style",
        profile_prompt:
          "Your style blends the looks you engaged with—refined through quick swipes. Explore communities to go deeper.",
        profileTags: [],
        recommendedCommunities: [],
        initialFeedPosts: [],
        traits: {},
        confidence: 0,
      })
    }
  }, [sessionId, guestSessionId, userId])

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

          if (unlimited && userId && sessionId) {
            const batch = Math.floor(nextCount / 5)
            if (batch > 0 && batch > refreshedSwipeBatch.current) {
              refreshedSwipeBatch.current = batch
              void fetch("/api/profile/refresh-from-swipes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, uptoPosition: nextCount }),
              }).catch(() => {
                // Silent background refresh only.
              })
            }
          }

          if (data.done) {
            setPhase("profileLoading")
            await new Promise((r) => setTimeout(r, 1400))
            await runSummarize()
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
    [queue, sessionId, phase, swipeCount, guestSessionId, userId, runSummarize],
  )

  const currentOutfit = queue[0]
  const nextOutfit = queue[1]
  const progress = Math.min((swipeCount / TARGET_SWIPES) * 100, 100)

  const showInitialPreparing =
    !initialDeckLoaded &&
    (phase === "loading" || (phase === "swiping" && queue.length === 0 && !error))

  if (showInitialPreparing) {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-center text-muted-foreground">Preparing your personalized deck…</p>
        </div>
      </MobileAppFrame>
    )
  }

  /** Deck ran dry mid-session — auto-refill effect runs; show a light loader until cards arrive or error. */
  const showRefillLoading =
    initialDeckLoaded && phase === "swiping" && queue.length === 0 && sessionId && !error

  if (showRefillLoading) {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading more looks…</p>
        </div>
      </MobileAppFrame>
    )
  }

  if (error && queue.length === 0) {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <p className="mb-4 text-destructive">{error}</p>
          <p className="text-sm text-muted-foreground">
            Ensure SUPABASE_SERVICE_ROLE_KEY is set for swipe APIs.
          </p>
        </div>
      </MobileAppFrame>
    )
  }

  if (phase === "profileLoading") {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <ProfileGeneratingSplash />
      </MobileAppFrame>
    )
  }

  if (phase === "done" && handoff) {
    const styleTitle =
      handoff.style_name?.trim() ||
      (handoff.profileTags[0]
        ? handoff.profileTags[0]!.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Your signature look")
    const notes = splitProfileIntoNotes(handoff.profile_prompt)

    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-1 flex-col items-center justify-center bg-background px-5 py-10"
        >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: "spring" }}
          className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mb-8"
        >
          <Sparkles className="w-8 h-8 text-accent-foreground" />
        </motion.div>

        <StyleProfileReveal styleName={styleTitle} notes={notes.length ? notes : [handoff.profile_prompt]} />

        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {handoff.profileTags.slice(0, 10).map((tag) => (
            <span
              key={tag}
              className="px-4 py-2 rounded-full bg-secondary text-secondary-foreground text-sm font-medium"
            >
              #{tag}
            </span>
          ))}
        </div>

        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          {userId ? (
            <button
              onClick={() => onComplete(handoff)}
              className="w-full flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
            >
              Save & Enter Style Hub
              <ArrowRight className="w-5 h-5" />
            </button>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Log in to save your profile and unlock the feed.
              </p>
              <button
                onClick={() => router.push("/auth/login?next=/feed")}
                className="w-full flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
              >
                <LogIn className="w-5 h-5" />
                Log in to save
              </button>
              <button
                onClick={() => router.push("/auth/sign-up")}
                className="w-full flex items-center justify-center gap-2 px-8 py-3 rounded-full border border-border text-foreground font-medium hover:bg-secondary transition-colors"
              >
                Create account
              </button>
            </>
          )}

          <div className="flex items-center gap-3 w-full pt-2">
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-secondary text-secondary-foreground font-medium hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="w-4 h-4" />
              Redo
            </button>
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-full text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
        </motion.div>
      </MobileAppFrame>
    )
  }

  return (
    <>
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative z-[1] shrink-0 px-3 pb-1 pt-1">
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <h1 className="text-sm font-semibold leading-tight tracking-tight text-foreground">Discover</h1>
              <div className="flex items-center gap-2">
                {onExit && (
                  <button
                    type="button"
                    onClick={onExit}
                    className="rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    Exit
                  </button>
                )}
                <span className="tabular-nums text-[10px] font-medium text-muted-foreground">
                  {swipeCount} / {unlimited ? "∞" : TARGET_SWIPES}
                </span>
              </div>
            </div>
            {!unlimited && (
              <div className="h-0.5 overflow-hidden rounded-full bg-secondary shadow-inner">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-accent/90 to-accent shadow-[0_0_8px_color-mix(in_oklch,var(--accent)_35%,transparent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>

          <div className="relative z-[1] flex min-h-0 flex-1 flex-col px-2 pt-0">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center pb-1">
              <div
                className="pointer-events-none absolute left-1/2 top-[40%] -z-10 h-[min(32vh,14rem)] w-[min(90%,19rem)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/14 blur-2xl dark:bg-accent/10"
                aria-hidden
              />
              <div className="relative mx-auto aspect-[3/5] w-full max-w-[min(20.5rem,calc(100%-0.5rem))]">
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
                      onDevDeleteCandidate={
                        process.env.NODE_ENV === "development" ? handleDevDeleteCandidate : undefined
                      }
                    />
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="shrink-0 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
              <SwipeButtons onSwipe={handleSwipe} variant="bar" />
            </div>
          </div>
        </div>
      </MobileAppFrame>
      {process.env.NODE_ENV === "development" && <DevGoogleSearchToggle />}
    </>
  )
}
