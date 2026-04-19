import type { createServiceClient } from "@/lib/supabase/admin"
import { generateStyleIntroDeepen, generateStyleRefine } from "@/lib/ai/gemini-style-swipes"
import {
  buildWeightsFromSignals,
  topPositiveTags,
  type SwipeSignal,
} from "@/lib/ranking/next-candidate"
import type { StyleIntroGuidance } from "@/lib/ai/style-swipe-schemas"
import { writeStyleProfileFile } from "@/lib/style-profile/file-store"

type Admin = ReturnType<typeof createServiceClient>

type JournalEntry = {
  at: number
  phase: "intro" | "refine"
  createdAt: string
  gemini: boolean
  payload: Record<string, unknown>
}

/** Serialize intro/refine per session so overlapping requests do not double-append the journal or call Gemini twice. */
const introInFlight = new Map<string, Promise<void>>()
const refineInFlight = new Map<string, Promise<void>>()

async function journalHasEntry(
  admin: Admin,
  sessionId: string,
  phase: JournalEntry["phase"],
  at: number,
): Promise<boolean> {
  const { data: row } = await admin.from("swipe_sessions").select("style_journal").eq("id", sessionId).single()
  const j = row?.style_journal
  if (!Array.isArray(j)) return false
  return j.some((raw) => {
    if (!raw || typeof raw !== "object") return false
    const e = raw as Record<string, unknown>
    return e.phase === phase && e.at === at
  })
}

function heuristicIntro(signals: SwipeSignal[]): StyleIntroGuidance {
  const slice = signals.slice(0, 5)
  const { tagWeights } = buildWeightsFromSignals(slice)
  const tags = topPositiveTags(tagWeights, 12)
  return {
    observed_lean: tags.slice(0, 4).join(", ") || "exploratory mix",
    intro_summary:
      "Early swipe signals (heuristic): liked directions inform tag weights until Gemini is available.",
    specific_ideas: [
      "structured outer layers",
      "footwear as anchor",
      "texture and fabric contrast",
      "palette cohesion experiments",
    ],
    prefer_style_tags: tags.length ? tags : ["discovered", "full-look"],
    general_every_n: 3,
  }
}

async function appendJournal(admin: Admin, sessionId: string, entry: JournalEntry): Promise<void> {
  const { data: row, error } = await admin
    .from("swipe_sessions")
    .select("style_journal")
    .eq("id", sessionId)
    .single()

  if (error) {
    console.error("[style-phase] appendJournal read", error)
    return
  }

  const prev = Array.isArray(row?.style_journal) ? (row.style_journal as unknown[]) : []
  const next = [...prev, entry]

  const { error: upErr } = await admin
    .from("swipe_sessions")
    .update({ style_journal: next as unknown as Record<string, unknown> })
    .eq("id", sessionId)

  if (upErr) {
    console.error("[style-phase] appendJournal update", upErr)
    return
  }
}

function mergeGuidance(
  base: Record<string, unknown>,
  refine: Record<string, unknown>,
): Record<string, unknown> {
  const prefer =
    Array.isArray(refine.prefer_style_tags) && refine.prefer_style_tags.length
      ? refine.prefer_style_tags
      : base.prefer_style_tags
  const ideas =
    Array.isArray(refine.specific_ideas) && refine.specific_ideas.length
      ? refine.specific_ideas
      : base.specific_ideas
  const every =
    typeof refine.general_every_n === "number" ? refine.general_every_n : base.general_every_n
  return {
    ...base,
    ...refine,
    prefer_style_tags: prefer,
    specific_ideas: ideas,
    general_every_n: typeof every === "number" ? every : 3,
  }
}

async function persistFileSnapshot(admin: Admin, sessionId: string): Promise<void> {
  const { data: s } = await admin
    .from("swipe_sessions")
    .select("id, style_journal, style_guidance, reddit_profile_seed, started_at, completed_at")
    .eq("id", sessionId)
    .single()

  try {
    await writeStyleProfileFile(sessionId, {
      sessionId,
      updatedAt: new Date().toISOString(),
      journal: s?.style_journal ?? [],
      guidance: s?.style_guidance ?? null,
      reddit_profile_seed: s?.reddit_profile_seed ?? null,
      started_at: s?.started_at,
      completed_at: s?.completed_at ?? null,
    })
  } catch (e) {
    console.warn("[style-phase] writeStyleProfileFile (optional local snapshot)", e)
  }
}

async function runStyleIntroPhaseWork(admin: Admin, sessionId: string, signals: SwipeSignal[]): Promise<void> {
  if (await journalHasEntry(admin, sessionId, "intro", 5)) return

  const introSignals = signals.slice(0, 5)
  const lines = await buildSwipeLines(admin, sessionId, 5)
  const gemini = await generateStyleIntroDeepen(lines)
  const guidance = gemini ?? heuristicIntro(introSignals)

  const entry: JournalEntry = {
    at: 5,
    phase: "intro",
    createdAt: new Date().toISOString(),
    gemini: !!gemini,
    payload: guidance as unknown as Record<string, unknown>,
  }
  await appendJournal(admin, sessionId, entry)
  await admin
    .from("swipe_sessions")
    .update({ style_guidance: guidance as unknown as Record<string, unknown> })
    .eq("id", sessionId)
  await persistFileSnapshot(admin, sessionId)
}

export async function runStyleIntroPhase(admin: Admin, sessionId: string, signals: SwipeSignal[]): Promise<void> {
  if (await journalHasEntry(admin, sessionId, "intro", 5)) return

  const existing = introInFlight.get(sessionId)
  if (existing) {
    await existing
    return
  }

  const work = runStyleIntroPhaseWork(admin, sessionId, signals)
  introInFlight.set(sessionId, work)
  try {
    await work
  } finally {
    introInFlight.delete(sessionId)
  }
}

async function runStyleRefinePhaseWork(
  admin: Admin,
  sessionId: string,
  atPosition: number,
  signals: SwipeSignal[],
): Promise<void> {
  if (await journalHasEntry(admin, sessionId, "refine", atPosition)) return

  const { data: sess } = await admin
    .from("swipe_sessions")
    .select("style_guidance")
    .eq("id", sessionId)
    .single()

  const prior = sess?.style_guidance ?? null
  const lines = await buildSwipeLines(admin, sessionId, atPosition)
  const gemini = await generateStyleRefine({
    swipeLines: lines,
    priorGuidance: prior,
    phaseLabel: `after position ${atPosition}`,
  })

  let merged: Record<string, unknown>
  if (gemini) {
    merged = mergeGuidance(
      (prior && typeof prior === "object" ? prior : {}) as Record<string, unknown>,
      gemini as unknown as Record<string, unknown>,
    )
  } else {
    const h = heuristicIntro(signals.slice(0, 5))
    const { tagWeights } = buildWeightsFromSignals(signals)
    const refinedTags = topPositiveTags(tagWeights, 14)
    merged = mergeGuidance(
      (prior && typeof prior === "object" ? prior : (h as unknown as Record<string, unknown>)) as Record<string, unknown>,
      {
        refinement_notes: "Heuristic refine (Gemini unavailable).",
        prefer_style_tags: refinedTags.length ? refinedTags : h.prefer_style_tags,
      },
    )
  }

  const reddit =
    gemini && typeof gemini.reddit_style_brief === "string" && gemini.reddit_style_brief.trim()
      ? gemini.reddit_style_brief.trim()
      : null

  const entry: JournalEntry = {
    at: atPosition,
    phase: "refine",
    createdAt: new Date().toISOString(),
    gemini: !!gemini,
    payload: (gemini ?? merged) as Record<string, unknown>,
  }
  await appendJournal(admin, sessionId, entry)

  const update: Record<string, unknown> = { style_guidance: merged }
  if (reddit) update.reddit_profile_seed = reddit

  await admin.from("swipe_sessions").update(update).eq("id", sessionId)
  await persistFileSnapshot(admin, sessionId)
}

export async function runStyleRefinePhase(
  admin: Admin,
  sessionId: string,
  atPosition: number,
  signals: SwipeSignal[],
): Promise<void> {
  if (await journalHasEntry(admin, sessionId, "refine", atPosition)) return

  const key = `${sessionId}:${atPosition}`
  const existing = refineInFlight.get(key)
  if (existing) {
    await existing
    return
  }

  const work = runStyleRefinePhaseWork(admin, sessionId, atPosition, signals)
  refineInFlight.set(key, work)
  try {
    await work
  } finally {
    refineInFlight.delete(key)
  }
}

async function buildSwipeLines(admin: Admin, sessionId: string, maxPosition: number): Promise<string> {
  const { data: events } = await admin
    .from("swipe_events")
    .select("candidate_id, direction, position")
    .eq("session_id", sessionId)
    .lte("position", maxPosition)
    .order("position", { ascending: true })

  const ids = [...new Set((events ?? []).map((e) => e.candidate_id as string))]
  if (!ids.length) return ""

  const { data: cands } = await admin
    .from("outfit_candidates")
    .select("id, title, brand_name, style_tags")
    .in("id", ids)

  const byId = new Map((cands ?? []).map((r) => [r.id as string, r]))
  const lines: string[] = []

  for (const ev of events ?? []) {
    const c = byId.get(ev.candidate_id as string)
    const tags = (c?.style_tags as string[])?.join(", ") ?? ""
    const brand = (c?.brand_name as string) ?? "unknown brand"
    const title = (c?.title as string) ?? "look"
    lines.push(`pos ${ev.position}: ${ev.direction} — ${title} (${brand}) tags: [${tags}]`)
  }

  return lines.join("\n")
}
