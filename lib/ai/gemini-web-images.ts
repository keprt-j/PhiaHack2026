/**
 * Uses Gemini with Google Search grounding to find real image URLs on the web,
 * then validates bytes via fetch (same path as vision classify).
 */

import { GoogleGenerativeAI, type GenerateContentResult, type ModelParams } from "@google/generative-ai"
import { z } from "zod"
import { getDevGoogleSearchDisabled } from "@/lib/dev/google-search-flag"

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"
const GENERATE_TIMEOUT_MS = 90_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Gemini web discover timed out")), ms)
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

function stripJsonFence(s: string): string {
  const t = s.trim()
  if (t.startsWith("```")) {
    return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  }
  return t
}

const itemSchema = z.object({
  image_url: z.string().url(),
  title: z.string().max(200),
  style_tags: z.array(z.string()).max(14),
})

const payloadSchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
})

export type WebDiscoveredItem = z.infer<typeof itemSchema>

function getSearchModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key) return null
  const gen = new GoogleGenerativeAI(key)
  /** Gemini 3+ expects `google_search` (SDK: `googleSearch`), not legacy `google_search_retrieval`. */
  const tools = [{ googleSearch: {} }] as unknown as ModelParams["tools"]
  return gen.getGenerativeModel({
    model: MODEL,
    tools,
  })
}

/**
 * Loose URL gate: accept anything HTTPS, since the downstream fetch will follow `og:image`
 * for HTML pages. Reject only obviously non-fetchable schemes / blank values.
 */
function looksFetchable(url: string): boolean {
  const u = url.toLowerCase().trim()
  if (!u.startsWith("https://") && !u.startsWith("http://")) return false
  if (u.length < 12) return false
  return true
}

function groundingImageUris(res: GenerateContentResult): string[] {
  const chunks = res.response.candidates?.[0]?.groundingMetadata?.groundingChunks
  if (!chunks?.length) return []
  const out: string[] = []
  for (const ch of chunks) {
    const u = ch.web?.uri
    if (u && looksFetchable(u)) out.push(u)
  }
  return [...new Set(out)]
}

export type DiscoverOpts = {
  /** User-derived positive style tags (kebab-case). */
  likeTags?: string[]
  /** Tags the user actively swiped away from. */
  dislikeTags?: string[]
  /** Free-form persona / vibe brief from the style refine phase. */
  brief?: string
}

/**
 * Ask Gemini (with Google Search) for outfit photo URLs matching `searchTheme`, validate as fetchable images.
 * `opts` lets the caller bias the search toward the live user's preferences.
 */
export async function discoverOutfitImagesFromWeb(
  searchTheme: string,
  opts: DiscoverOpts = {},
): Promise<WebDiscoveredItem[]> {
  if (process.env.GEMINI_WEB_DISCOVER === "0") return []
  if (getDevGoogleSearchDisabled()) {
    console.warn("[gemini-web-images] dev: Google Search disabled (toggle)")
    return []
  }

  const model = getSearchModel()
  if (!model) return []

  const likes = (opts.likeTags ?? []).filter(Boolean).slice(0, 10)
  const dislikes = (opts.dislikeTags ?? []).filter(Boolean).slice(0, 8)
  const brief = (opts.brief ?? "").trim().slice(0, 600)

  const prefBlock = [
    likes.length ? `LIKES (must heavily reflect): ${likes.join(", ")}` : "",
    dislikes.length ? `AVOID (do not surface): ${dislikes.join(", ")}` : "",
    brief ? `STYLE BRIEF: ${brief}` : "",
  ]
    .filter(Boolean)
    .join("\n")

  const prompt = `You can use Google Search. Find diverse fashion photographs matching this theme:
"${searchTheme}"

${prefBlock}

Return ONLY valid JSON (no markdown) in this exact shape:
{"items":[{"image_url":"https://...","title":"short caption","style_tags":["tag1","tag2"]}]}

Prefer HTTPS URLs that look like direct image files or stable CDNs (Unsplash, Pexels, editorial CDNs). Copy real URLs from search results; avoid obvious 404 paths.

Composition (these will be filtered downstream for segmentation / app integrations):
- Prefer ONE clear subject per image, full-body or three-quarter, outfit readable; avoid dense crowds, tiny figures, or heavy overlapping people.
- Favor simple backgrounds or strong subject/background separation when possible.

Other rules:
- 12–16 items. style_tags: lowercase kebab-case (max 6 per item).
- Titles max 120 characters.`

  try {
    const raw = await withTimeout(model.generateContent(prompt), GENERATE_TIMEOUT_MS)
    const text = raw.response.text()
    const groundingUris = groundingImageUris(raw)
    const fromGrounding: WebDiscoveredItem[] = groundingUris.slice(0, 14).map((image_url, i) => ({
      image_url,
      title: `Web look ${i + 1}`,
      style_tags: ["discovered", "web"],
    }))

    let fromJson: WebDiscoveredItem[] = []
    try {
      const parsed = JSON.parse(stripJsonFence(text))
      const r = payloadSchema.safeParse(parsed)
      if (r.success) fromJson = r.data.items
    } catch {
      /* JSON parse failed — grounding list may still help */
    }

    const merged: WebDiscoveredItem[] = [...fromGrounding, ...fromJson]

    const validated: WebDiscoveredItem[] = []
    for (const it of merged) {
      if (!looksFetchable(it.image_url)) continue
      validated.push({
        image_url: it.image_url.trim(),
        title: it.title.trim().slice(0, 180),
        style_tags: it.style_tags.map((t) => t.toLowerCase().replace(/\s+/g, "-")).filter(Boolean).slice(0, 12),
      })
      if (validated.length >= 20) break
    }

    return validated
  } catch (e) {
    console.warn("[gemini-web-images] discoverOutfitImagesFromWeb", e)
    return []
  }
}
