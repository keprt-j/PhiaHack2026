/** Pinterest-style post reactions (stored in `post_votes.vote_type`). */
export const POST_REACTION_IDS = ["love", "cry", "neutral", "wow", "fire"] as const

export type PostReactionId = (typeof POST_REACTION_IDS)[number]

export const POST_REACTIONS: readonly {
  id: PostReactionId
  emoji: string
  label: string
}[] = [
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "cry", emoji: "😢", label: "Moved" },
  { id: "neutral", emoji: "😐", label: "Neutral" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "fire", emoji: "🔥", label: "Fire" },
] as const

/** DB / API column names for per-reaction totals on `posts`. */
export type PostReactionCounts = {
  reaction_love: number
  reaction_cry: number
  reaction_neutral: number
  reaction_wow: number
  reaction_fire: number
}

const COLUMN: Record<PostReactionId, keyof PostReactionCounts> = {
  love: "reaction_love",
  cry: "reaction_cry",
  neutral: "reaction_neutral",
  wow: "reaction_wow",
  fire: "reaction_fire",
}

export function reactionColumn(id: PostReactionId): keyof PostReactionCounts {
  return COLUMN[id]
}

export function totalPostReactions(post: PostReactionCounts): number {
  return (
    (post.reaction_love ?? 0) +
    (post.reaction_cry ?? 0) +
    (post.reaction_neutral ?? 0) +
    (post.reaction_wow ?? 0) +
    (post.reaction_fire ?? 0)
  )
}
