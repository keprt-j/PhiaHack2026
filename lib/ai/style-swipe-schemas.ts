import { z } from "zod"

/** After 5 swipes — deepen into specific garments + tags */
export const styleIntroGuidanceSchema = z.object({
  observed_lean: z.string().max(200),
  intro_summary: z.string().max(1200),
  specific_ideas: z.array(z.string()).min(2).max(12),
  prefer_style_tags: z.array(z.string()).min(2).max(16),
  general_every_n: z.number().int().min(2).max(5).default(3),
})

export type StyleIntroGuidance = z.infer<typeof styleIntroGuidanceSchema>

/** Mid-session refinement (e.g. after 10 or 15 swipes) */
export const styleRefineGuidanceSchema = z.object({
  observed_lean: z.string().max(200).optional(),
  refinement_notes: z.string().max(800).optional(),
  specific_ideas: z.array(z.string()).max(14).optional(),
  prefer_style_tags: z.array(z.string()).max(16).optional(),
  general_every_n: z.number().int().min(2).max(5).optional(),
  reddit_style_brief: z.string().max(2500).optional(),
})

export type StyleRefineGuidance = z.infer<typeof styleRefineGuidanceSchema>

export type StyleGuidanceMerged = StyleIntroGuidance & {
  reddit_style_brief?: string
}
