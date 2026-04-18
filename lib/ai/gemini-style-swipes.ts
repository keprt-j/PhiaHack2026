import { GoogleGenerativeAI } from "@google/generative-ai"
import { STYLE_SWIPE_INTRO_DEEPEN, STYLE_SWIPE_REFINE } from "@/lib/ai/prompts"
import {
  styleIntroGuidanceSchema,
  styleRefineGuidanceSchema,
  type StyleIntroGuidance,
  type StyleRefineGuidance,
} from "@/lib/ai/style-swipe-schemas"

/** Override with `GEMINI_MODEL` if you need a different release. */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"
const GENERATE_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini generateContent timed out")), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const gen = new GoogleGenerativeAI(key)
  return gen.getGenerativeModel({ model: MODEL })
}

function stripJsonFence(s: string): string {
  const t = s.trim()
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  }
  return t
}

export async function generateStyleIntroDeepen(swipeLines: string): Promise<StyleIntroGuidance | null> {
  const model = getModel()
  if (!model) return null
  try {
    const prompt = `${STYLE_SWIPE_INTRO_DEEPEN}\n\nSwipe lines:\n${swipeLines}`
    const res = await withTimeout(model.generateContent(prompt), GENERATE_TIMEOUT_MS)
    const out = res.response.text()
    const parsed = JSON.parse(stripJsonFence(out))
    const r = styleIntroGuidanceSchema.safeParse(parsed)
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export async function generateStyleRefine(input: {
  swipeLines: string
  priorGuidance: unknown
  phaseLabel: string
}): Promise<StyleRefineGuidance | null> {
  const model = getModel()
  if (!model) return null
  try {
    const prior =
      input.priorGuidance && typeof input.priorGuidance === "object"
        ? JSON.stringify(input.priorGuidance, null, 2)
        : "(none)"
    const prompt = `${STYLE_SWIPE_REFINE}\n\nPhase: ${input.phaseLabel}\n\nPrior guidance JSON:\n${prior}\n\nSwipe lines:\n${input.swipeLines}`
    const res = await withTimeout(model.generateContent(prompt), GENERATE_TIMEOUT_MS)
    const out = res.response.text()
    const parsed = JSON.parse(stripJsonFence(out))
    const r = styleRefineGuidanceSchema.safeParse(parsed)
    return r.success ? r.data : null
  } catch {
    return null
  }
}
