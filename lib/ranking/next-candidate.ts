import type { CandidateRow } from "@/lib/candidates/map-to-outfit"

/** Subset of `style_guidance` used when ranking / exploring */
export type StylePickGuidance = {
  prefer_style_tags: string[]
  general_every_n: number
}

export function parseStylePickGuidance(raw: unknown): StylePickGuidance | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const tags = Array.isArray(o.prefer_style_tags)
    ? o.prefer_style_tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase())
        .filter(Boolean)
    : []
  const n = o.general_every_n
  const ge = typeof n === "number" && n >= 2 && n <= 5 ? Math.round(n) : 3
  if (tags.length < 1) return null
  return { prefer_style_tags: tags, general_every_n: ge }
}

export type SwipeSignal = {
  candidateId: string
  direction: "left" | "right" | "super"
  tags: string[]
  brand: string | null
}

/** First swipes weigh more — they establish genre before later exploration */
const EARLY_SWIPE_WEIGHTS = [2.25, 1.9, 1.55, 1.3, 1.12]

function earlyWeight(swipeIndex: number): number {
  return swipeIndex < EARLY_SWIPE_WEIGHTS.length ? EARLY_SWIPE_WEIGHTS[swipeIndex]! : 1
}

function exploreRateForSession(signalCount: number): number {
  if (signalCount >= 6) return 0.1
  if (signalCount >= 3) return 0.14
  return 0.2
}

function scoreOne(
  c: CandidateRow,
  tagWeights: Map<string, number>,
  brandWeights: Map<string, number>,
  opts?: { guidanceTagSet?: Set<string> },
): number {
  let s = 0
  for (const t of c.style_tags ?? []) {
    const k = t.toLowerCase()
    const w = tagWeights.get(k)
    if (w) s += w
    if (opts?.guidanceTagSet?.has(k)) s += 0.34
  }
  if (c.brand_name) {
    const b = c.brand_name.toLowerCase()
    const w = brandWeights.get(b)
    if (w) s += w * 2
  }
  if (c.is_trending) s += 0.12
  if (c.source_type === "web_gemini") s += 0.55
  if ((c.style_tags ?? []).some((t) => t.toLowerCase() === "export-ready")) s += 0.18
  return s
}

/** Chronological swipe index gets higher weight for likes/dislikes (genre lock-in). */
export function buildWeightsFromSignals(signals: SwipeSignal[]): {
  tagWeights: Map<string, number>
  brandWeights: Map<string, number>
} {
  const tagWeights = new Map<string, number>()
  const brandWeights = new Map<string, number>()

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i]!
    const ew = earlyWeight(i)

    const base =
      s.direction === "super" ? 1.45 : s.direction === "right" ? 1 : -0.42
    const effective = base * ew * (s.direction === "left" ? 1.12 : 1)

    if (s.direction === "left") {
      for (const t of s.tags) {
        const k = t.toLowerCase()
        tagWeights.set(k, (tagWeights.get(k) ?? 0) + effective)
      }
      if (s.brand) {
        const b = s.brand.toLowerCase()
        brandWeights.set(b, (brandWeights.get(b) ?? 0) + effective * 0.55)
      }
      continue
    }
    for (const t of s.tags) {
      const k = t.toLowerCase()
      tagWeights.set(k, (tagWeights.get(k) ?? 0) + effective)
    }
    if (s.brand) {
      const b = s.brand.toLowerCase()
      brandWeights.set(b, (brandWeights.get(b) ?? 0) + effective)
    }
  }

  return { tagWeights, brandWeights }
}

export function topPositiveTags(tagWeights: Map<string, number>, limit: number): string[] {
  return [...tagWeights.entries()]
    .filter(([, w]) => w > 0.12)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t)
}

/** Strongest dislike tags (most-negative weights). Used to bias web discovery away from them. */
export function topNegativeTags(tagWeights: Map<string, number>, limit: number): string[] {
  return [...tagWeights.entries()]
    .filter(([, w]) => w < -0.12)
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([t]) => t)
}

export function positiveSwipeCount(signals: SwipeSignal[]): number {
  return signals.filter((s) => s.direction !== "left").length
}

/** Fisher–Yates — new order every call so tie-breaks aren’t stuck on DB row order */
function shuffleArray<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function isWebGeminiRow(c: CandidateRow): boolean {
  return c.source_type === "web_gemini"
}

/** First N swipe slots use only seed / scrape / ingest rows — not `web_gemini` discover. */
export const INTRO_SWIPE_SLOTS = 3

function pickOneCandidate(
  pool: CandidateRow[],
  signals: SwipeSignal[],
  opts?: { deckPosition?: number; guidance?: StylePickGuidance | null },
): CandidateRow | null {
  if (pool.length === 0) return null

  const available = shuffleArray(pool)

  const { tagWeights, brandWeights } = buildWeightsFromSignals(signals)
  const dp = opts?.deckPosition
  const g = opts?.guidance
  const guidanceTagSet =
    dp && dp > 5 && g?.prefer_style_tags?.length
      ? new Set(g.prefer_style_tags.map((t) => t.toLowerCase()))
      : undefined
  const generalEvery = g?.general_every_n && g.general_every_n >= 2 ? g.general_every_n : 3
  const generalBeat = !!(dp && dp > 5 && g && (dp - 5) % generalEvery === 0)

  const explore =
    generalBeat || (!generalBeat && Math.random() < exploreRateForSession(signals.length))
  const scored = available.map((c) => ({
    c,
    score: explore
      ? Math.random()
      : scoreOne(c, tagWeights, brandWeights, generalBeat ? undefined : { guidanceTagSet }),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.c ?? null
}

export type PickNextOpts = {
  deckPosition?: number
  guidance?: StylePickGuidance | null
  /**
   * 1-based swipe index of the first card this call will emit (next card in session order).
   * Swipe slots `1..INTRO_SWIPE_SLOTS` exclude `web_gemini` so the intro is non-discover images.
   */
  upcomingSwipeStart?: number
}

export function pickNextCandidates(
  pool: CandidateRow[],
  seenIds: Set<string>,
  signals: SwipeSignal[],
  count: number,
  opts?: PickNextOpts,
): CandidateRow[] {
  const start = opts?.upcomingSwipeStart
  if (start !== undefined) {
    const used = new Set(seenIds)
    const out: CandidateRow[] = []
    for (let i = 0; i < count; i++) {
      const slot = start + i
      const introSlot = slot <= INTRO_SWIPE_SLOTS
      let candidates = pool.filter((c) => !used.has(c.id))
      if (introSlot) {
        const noGemini = candidates.filter((c) => !isWebGeminiRow(c))
        if (noGemini.length) candidates = noGemini
        else if (candidates.length)
          console.warn(
            "[next-candidate] intro slot",
            slot,
            "has only web_gemini — using full pool so the deck does not stall",
          )
      }
      const one = pickOneCandidate(candidates, signals, { ...opts, deckPosition: slot })
      if (!one) break
      used.add(one.id)
      out.push(one)
    }
    return out
  }

  const filtered = pool.filter((c) => !seenIds.has(c.id))
  if (filtered.length === 0) return []

  const available = shuffleArray(filtered)

  const { tagWeights, brandWeights } = buildWeightsFromSignals(signals)
  const dp = opts?.deckPosition
  const g = opts?.guidance
  const guidanceTagSet =
    dp && dp > 5 && g?.prefer_style_tags?.length
      ? new Set(g.prefer_style_tags.map((t) => t.toLowerCase()))
      : undefined
  const generalEvery = g?.general_every_n && g.general_every_n >= 2 ? g.general_every_n : 3
  const generalBeat =
    !!(dp && dp > 5 && g && (dp - 5) % generalEvery === 0)

  const explore =
    generalBeat || (!generalBeat && Math.random() < exploreRateForSession(signals.length))
  const scored = available.map((c) => ({
    c,
    score: explore
      ? Math.random()
      : scoreOne(c, tagWeights, brandWeights, generalBeat ? undefined : { guidanceTagSet }),
  }))
  scored.sort((a, b) => b.score - a.score)

  const out: CandidateRow[] = []
  const used = new Set<string>()
  for (const { c } of scored) {
    if (out.length >= count) break
    if (used.has(c.id)) continue
    used.add(c.id)
    out.push(c)
  }

  if (out.length < count) {
    const rest = available.filter((c) => !used.has(c.id))
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    for (const c of rest) {
      if (out.length >= count) break
      out.push(c)
    }
  }

  return out.slice(0, count)
}
