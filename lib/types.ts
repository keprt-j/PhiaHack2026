import type { PostReactionCounts, PostReactionId } from "@/lib/post-reactions"

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  style_tags: string[]
  has_completed_onboarding: boolean
  created_at: string
  updated_at: string
}

export interface Outfit {
  id: string
  title: string
  description: string | null
  image_url: string
  brand: string | null
  price_range: string | null
  style_tags: string[]
  category: string | null
  /** pinterest | instagram | other — when ingested via social scrape */
  source_platform?: string | null
  /** e.g. `web_gemini` when found via Gemini + Google Search */
  source_type?: string | null
  /** Original product or editorial URL when ingested (retail / social / web). */
  source_url?: string | null
  is_trending: boolean
  likes_count: number
  created_at: string
}

export interface Swipe {
  id: string
  user_id: string
  outfit_id: string
  direction: 'left' | 'right' | 'super'
  created_at: string
}

export interface Community {
  id: string
  name: string
  slug: string
  description: string | null
  icon_url: string | null
  cover_url: string | null
  member_count: number
  created_at: string
}

export interface CommunityMember {
  id: string
  user_id: string
  community_id: string
  joined_at: string
}

export interface Post extends PostReactionCounts {
  id: string
  user_id: string
  community_id: string | null
  title: string
  content: string | null
  image_url: string | null
  outfit_tags: string[]
  /** Sum of all reaction counts (trending / legacy). */
  upvotes: number
  comments_count: number
  is_trending: boolean
  created_at: string
  // Joined data
  profiles?: Profile
  communities?: Community
}

export interface PostVote {
  id: string
  user_id: string
  post_id: string
  vote_type: PostReactionId
  created_at: string
}

export interface StyleTwin {
  id: string
  follower_id: string
  following_id: string
  created_at: string
}
