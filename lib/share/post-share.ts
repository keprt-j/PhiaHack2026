/**
 * Client-side helpers for sharing feed posts (Web Share, Pinterest pin builder, clipboard).
 */

export function getPostPublicUrl(postId: string): string {
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/post/${postId}`
}

export function buildPinterestSaveUrl(opts: {
  pageUrl: string
  imageUrl?: string | null
  description: string
}): string {
  const base = "https://www.pinterest.com/pin/create/button/"
  const params = new URLSearchParams()
  params.set("url", opts.pageUrl)
  if (opts.imageUrl) params.set("media", opts.imageUrl)
  params.set("description", opts.description.slice(0, 500))
  return `${base}?${params.toString()}`
}

export async function sharePostWithNavigator(opts: {
  title: string
  text: string
  url: string
}): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.share) return false
  try {
    await navigator.share({
      title: opts.title,
      text: opts.text,
      url: opts.url,
    })
    return true
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return true
    return false
  }
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
