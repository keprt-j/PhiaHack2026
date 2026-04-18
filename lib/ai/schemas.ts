import { z } from "zod"

export const classifierOutputSchema = z.object({
  style_tags: z.array(z.string()).min(1).max(12),
  category: z.string().optional(),
  vibe_labels: z.array(z.string()).max(8).optional(),
  occasion: z.string().optional(),
  season: z.string().optional(),
  silhouette: z.string().optional(),
  brand_affinity_hint: z.string().optional(),
  /** Vision-aligned card copy (prefer over raw OG text when present) */
  card_title: z.string().max(180).optional(),
  card_description: z.string().max(720).optional(),
})

export const styleProfileSchema = z.object({
  /** Short evocative label for the user, e.g. "Soft coastal minimal" — 2–5 words, Title Case */
  style_name: z.string().min(2).max(56).optional(),
  profile_prompt: z.string().min(40),
  traits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  preferred_brands: z.array(z.string()).max(20),
  disliked_brands: z.array(z.string()).max(20),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
})

export type ClassifierOutput = z.infer<typeof classifierOutputSchema>
export type StyleProfileOutput = z.infer<typeof styleProfileSchema>

/** Social scrape + vision — two-part card title, discoverable brands, vibe tags */
export const socialClassifierOutputSchema = z.object({
  style_tags: z.array(z.string()).min(1).max(14),
  card_title: z.string().min(4).max(120),
  card_description: z.string().max(720).optional(),
  inferred_brands: z.array(z.string().max(64)).max(5).optional(),
  price_range: z.string().max(80).optional(),
  category: z.string().optional(),
  vibe_labels: z.array(z.string()).max(8).optional(),
  occasion: z.string().optional(),
  season: z.string().optional(),
  silhouette: z.string().optional(),
})

export type SocialClassifierOutput = z.infer<typeof socialClassifierOutputSchema>
