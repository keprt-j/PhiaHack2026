import type { Outfit } from "@/lib/types"

export type CandidateRow = {
  id: string
  title: string
  description: string | null
  image_url: string
  brand_name: string | null
  price_range: string | null
  style_tags: string[] | null
  /** When set (e.g. from `outfit_candidates`), used to prefer web-discovered cards in ranking. */
  source_type?: string | null
  category: string | null
  /** Present when row is loaded from `outfit_candidates` with full select */
  classifier_output?: Record<string, unknown> | null
  source_platform?: string | null
  source_context?: Record<string, unknown> | null
  source_url?: string | null
  is_trending: boolean
  likes_count: number
  created_at: string
}

export function candidateRowToOutfit(row: CandidateRow): Outfit {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    image_url: row.image_url,
    brand: row.brand_name,
    price_range: row.price_range,
    style_tags: row.style_tags ?? [],
    category: row.category,
    source_platform: row.source_platform ?? null,
    source_type: row.source_type ?? null,
    source_url: row.source_url ?? null,
    is_trending: row.is_trending,
    likes_count: row.likes_count,
    created_at: row.created_at,
  }
}
