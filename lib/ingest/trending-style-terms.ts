/**
 * Curated “trending” vocabulary for scrape-time tagging + caption alignment.
 * Rotate/expand periodically; keep fashion-specific (not generic buzzwords).
 */
export const TRENDING_STYLE_TERMS = [
  "quiet luxury",
  "old money",
  "coastal grandmother",
  "gorpcore",
  "techwear",
  "streetwear",
  "minimal",
  "balletcore",
  "mob wife",
  "clean girl",
  "dark academia",
  "y2k",
  "scandi minimal",
  "workleisure",
  "elevated basics",
  "denim on denim",
  "monochrome",
  "layered tailoring",
  "sport luxe",
] as const

export type TrendingStyleTerm = (typeof TRENDING_STYLE_TERMS)[number]

export function pickTrendingTermsForPage(seed: string, count: number): string[] {
  const terms = [...TRENDING_STYLE_TERMS]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: string[] = []
  for (let i = 0; i < count && terms.length; i++) {
    const idx = (h + i * 17) % terms.length
    out.push(terms[idx])
  }
  return [...new Set(out)]
}
