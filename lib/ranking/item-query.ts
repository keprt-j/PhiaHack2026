import type { CandidateRow } from "@/lib/candidates/map-to-outfit"

const STOP = new Set([
  "the",
  "a",
  "an",
  "for",
  "and",
  "or",
  "with",
  "in",
  "on",
  "at",
  "to",
  "of",
  "my",
  "your",
  "some",
  "any",
  "looking",
  "find",
  "want",
])

/** Common garment / color words — used for light boosts, not as stopwords. */
const COLOR_WORDS = new Set([
  "black",
  "white",
  "navy",
  "beige",
  "brown",
  "red",
  "green",
  "blue",
  "tan",
  "gray",
  "grey",
  "olive",
  "burgundy",
  "cream",
  "ivory",
  "charcoal",
  "camel",
  "khaki",
  "pink",
  "yellow",
  "orange",
  "purple",
  "maroon",
])

/** Normalize typed item search into tokens for tag / text matching. */
export function tokenizeItemQuery(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP.has(w))
}

function collectJsonStrings(v: unknown, out: string[]): void {
  if (v == null) return
  if (typeof v === "string") {
    out.push(v.toLowerCase())
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) collectJsonStrings(x, out)
    return
  }
  if (typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) collectJsonStrings(x, out)
  }
}

/** Single searchable blob: title, description, tags, category, vision/classifier copy. */
function buildHaystack(row: CandidateRow): string {
  const parts: string[] = []
  parts.push((row.title || "").toLowerCase())
  parts.push((row.description || "").toLowerCase())
  parts.push((row.category || "").toLowerCase())
  for (const t of row.style_tags ?? []) parts.push(String(t).toLowerCase())
  if (row.classifier_output && typeof row.classifier_output === "object") {
    collectJsonStrings(row.classifier_output, parts)
  }
  return parts.join(" \n ")
}

/** Consecutive 2- and 3-word phrases from the query (e.g. "dress shirt", "black dress shirt"). */
function queryPhrases(tokens: string[], raw: string): string[] {
  const out: string[] = []
  const full = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (full.length >= 4) out.push(full)

  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`)
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`)
  }

  return [...new Set(out)].sort((a, b) => b.length - a.length)
}

function phraseScore(haystack: string, phrases: string[]): number {
  let s = 0
  for (const p of phrases) {
    if (p.length < 4) continue
    if (haystack.includes(p)) {
      const w = p.split(/\s+/).length
      s += 8 + w * 10
    }
  }
  return s
}

function tokenScore(haystack: string, tokens: string[], row: CandidateRow): number {
  let s = 0
  const tags = (row.style_tags ?? []).map((t) => String(t).toLowerCase())

  for (const t of tokens) {
    // "dress shirt" is a garment; don't match women's "dress" alone.
    if (t === "dress" && tokens.includes("shirt")) {
      const ok =
        haystack.includes("dress shirt") ||
        haystack.includes("dress-shirt") ||
        /\b(button|oxford|collar|formal)\b/.test(haystack)
      if (!ok) continue
    }

    let hit = false
    for (const g of tags) {
      if (g === t) {
        s += 12
        hit = true
        break
      }
      if (g.includes(t) || t.includes(g)) {
        s += 6
        hit = true
        break
      }
    }
    if (!hit) {
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, "i")
      if (re.test(haystack)) {
        s += COLOR_WORDS.has(t) ? 10 : 7
      } else if (haystack.includes(t)) {
        s += COLOR_WORDS.has(t) ? 5 : 3
      }
    }
  }
  return s
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tokenMentionedInHaystack(t: string, tokens: string[], haystack: string): boolean {
  if (t === "dress" && tokens.includes("shirt")) {
    return (
      haystack.includes("dress shirt") ||
      haystack.includes("dress-shirt") ||
      /\b(button|oxford|collar|formal)\b/.test(haystack)
    )
  }
  const re = new RegExp(`\\b${escapeRe(t)}\\b`, "i")
  return re.test(haystack) || haystack.includes(t)
}

/**
 * Extra weight when every search token is reflected in catalog text (color + garment + vibe).
 */
function fullQueryCoverageBonus(haystack: string, tokens: string[], raw: string): number {
  if (tokens.length < 2) return 0
  const ok = tokens.every((t) => tokenMentionedInHaystack(t, tokens, haystack))
  if (!ok) return 0
  const full = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (full.length >= 6 && haystack.includes(full)) return 32
  return 20
}

/** Score how well a catalog row matches an item search (phrases, tags, full-token coverage). */
export function scoreCandidateForItemQuery(row: CandidateRow, rawQuery: string): number {
  const q = rawQuery.trim()
  if (!q) return 0
  const tokens = tokenizeItemQuery(q)
  if (tokens.length === 0) return 0

  const haystack = buildHaystack(row)
  const phrases = queryPhrases(tokens, q)
  return (
    phraseScore(haystack, phrases) +
    tokenScore(haystack, tokens, row) +
    fullQueryCoverageBonus(haystack, tokens, q)
  )
}

/**
 * Theme string for Gemini / Unsplash discovery when the user is searching for a specific garment.
 * Kept explicit so search finds people wearing the item, not generic fashion noise.
 */
export function buildItemDiscoverKickTheme(userQuery: string): string {
  const q = userQuery.trim().slice(0, 180)
  return (
    `Fashion photograph for shopping: one adult wearing ${q}. ` +
    `The named garment must match the search literally — if the search says white, the shirt/top must read as white, off-white, or cream (not green, blue, or other colors). ` +
    `Full-body or three-quarter; clothing clearly visible; one person; editorial or street style; not flat-lay or hanger-only.`
  )
}
