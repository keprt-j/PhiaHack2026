import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDistanceToNow(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'just now'
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`
  }

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) {
    return `${diffInHours}h ago`
  }

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) {
    return `${diffInDays}d ago`
  }

  const diffInWeeks = Math.floor(diffInDays / 7)
  if (diffInWeeks < 4) {
    return `${diffInWeeks}w ago`
  }

  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) {
    return `${diffInMonths}mo ago`
  }

  const diffInYears = Math.floor(diffInDays / 365)
  return `${diffInYears}y ago`
}

/** Supabase join on `outfit_candidates` may return one object or an array depending on typings. */
export function outfitCandidateStyleTags(nested: unknown): string[] {
  if (nested == null) return []
  if (Array.isArray(nested)) {
    return nested.flatMap((x) =>
      x && typeof x === "object" && Array.isArray((x as { style_tags?: unknown }).style_tags)
        ? ((x as { style_tags: string[] }).style_tags ?? [])
        : [],
    )
  }
  if (typeof nested === "object" && Array.isArray((nested as { style_tags?: unknown }).style_tags)) {
    return (nested as { style_tags: string[] }).style_tags
  }
  return []
}

/** Reddit-style author line: real name when possible, not raw email / email-local-part. */
export function authorHandleForPost(
  profile: { display_name?: string | null; username?: string | null } | null | undefined,
): string {
  if (!profile) return "anonymous"

  const rawName = profile.display_name?.trim()
  if (rawName) {
    if (!rawName.includes("@")) return rawName
    const local = rawName.split("@")[0]?.trim()
    if (local) return local.replace(/\./g, "_")
  }

  const rawUser = profile.username?.trim()
  if (rawUser) {
    if (!rawUser.includes("@")) return rawUser.replace(/\./g, "_")
    return rawUser.split("@")[0]!.replace(/\./g, "_")
  }

  return "anonymous"
}
