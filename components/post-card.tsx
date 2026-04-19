"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { MessageSquare, Share2, Bookmark, MoreHorizontal } from "lucide-react"
import { Post } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { authorHandleForPost, formatDistanceToNow } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  buildPinterestSaveUrl,
  copyTextToClipboard,
  getPostPublicUrl,
  sharePostWithNavigator,
} from "@/lib/share/post-share"
import { POST_REACTIONS, type PostReactionId } from "@/lib/post-reactions"

interface PostCardProps {
  post: Post
  userId: string | null
  initialReaction?: PostReactionId | null
  /** When true (default), title/body/image navigate to `/post/[id]`. */
  linkToPost?: boolean
  /** `detail` shows full body text and slightly larger title (post page). */
  variant?: "feed" | "detail"
}

type CountState = Record<PostReactionId, number>

function countsFromPost(post: Post): CountState {
  return {
    love: post.reaction_love ?? 0,
    cry: post.reaction_cry ?? 0,
    neutral: post.reaction_neutral ?? 0,
    wow: post.reaction_wow ?? 0,
    fire: post.reaction_fire ?? 0,
  }
}

export function PostCard({
  post,
  userId,
  initialReaction = null,
  linkToPost = true,
  variant = "feed",
}: PostCardProps) {
  const [selected, setSelected] = useState<PostReactionId | null>(initialReaction)
  const [counts, setCounts] = useState<CountState>(() => countsFromPost(post))
  const [isBookmarked, setIsBookmarked] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    setSelected(initialReaction)
  }, [initialReaction])

  useEffect(() => {
    setCounts(countsFromPost(post))
  }, [
    post.id,
    post.reaction_love,
    post.reaction_cry,
    post.reaction_neutral,
    post.reaction_wow,
    post.reaction_fire,
  ])

  const handleReaction = async (type: PostReactionId) => {
    if (!userId) return

    const prev = selected
    const next: PostReactionId | null = prev === type ? null : type

    setCounts((c) => {
      const n = { ...c }
      if (prev) n[prev] = Math.max(0, n[prev] - 1)
      if (next) n[next] = n[next] + 1
      return n
    })
    setSelected(next)

    if (next) {
      const { error } = await supabase.from("post_votes").upsert(
        {
          user_id: userId,
          post_id: post.id,
          vote_type: next,
        },
        { onConflict: "user_id,post_id" },
      )
      if (error) {
        toast({ title: "Could not save reaction", variant: "destructive" })
        setSelected(prev)
        setCounts(countsFromPost(post))
      }
    } else {
      const { error } = await supabase.from("post_votes").delete().eq("user_id", userId).eq("post_id", post.id)
      if (error) {
        toast({ title: "Could not clear reaction", variant: "destructive" })
        setSelected(prev)
        setCounts(countsFromPost(post))
      }
    }
  }

  const postHref = `/post/${post.id}`
  const isDetail = variant === "detail"

  const shareSnippet =
    post.content?.replace(/__seed_core_posts_v1__/g, "").trim().slice(0, 280) || post.title

  const handleShareNative = async () => {
    const url = getPostPublicUrl(post.id)
    if (!url) return
    const shared = await sharePostWithNavigator({
      title: post.title,
      text: shareSnippet,
      url,
    })
    if (shared) {
      toast({ title: "Shared" })
      return
    }
    const copied = await copyTextToClipboard(url)
    toast({
      title: copied ? "Link copied" : "Could not copy",
      description: copied ? undefined : "Copy the address from your browser bar.",
    })
  }

  const handleCopyLink = async () => {
    const url = getPostPublicUrl(post.id)
    if (!url) return
    const ok = await copyTextToClipboard(url)
    toast({
      title: ok ? "Link copied" : "Copy failed",
      description: ok ? undefined : "Try copying from the address bar.",
    })
  }

  const handlePinterest = () => {
    const url = getPostPublicUrl(post.id)
    if (!url) return
    const pinUrl = buildPinterestSaveUrl({
      pageUrl: url,
      imageUrl: post.image_url,
      description: `${post.title} — ${shareSnippet}`.slice(0, 500),
    })
    window.open(pinUrl, "_blank", "noopener,noreferrer")
  }

  const postBody = (
    <>
      <div className={`px-3 pt-2.5 ${isDetail ? "pr-11" : "pr-10"}`}>
        <div className="min-w-0 flex-1">
          {post.communities && (
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">s/{post.communities.slug}</span>
              <span>·</span>
              <span>
                u/{authorHandleForPost(post.profiles)} · {formatDistanceToNow(post.created_at)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pb-2 pt-1">
        <h3
          className={`font-semibold leading-snug text-foreground ${
            isDetail ? "text-lg" : "text-[15px]"
          }`}
        >
          {post.title}
        </h3>
        {post.content && (
          <p
            className={`mt-1 text-sm leading-relaxed text-muted-foreground ${
              isDetail ? "" : "line-clamp-3"
            }`}
          >
            {post.content.replace(/__seed_core_posts_v1__/g, "").trim()}
          </p>
        )}
        {post.outfit_tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(isDetail ? post.outfit_tags : post.outfit_tags.slice(0, 4)).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {post.image_url && (
        <div
          className={`relative bg-gradient-to-br from-violet-200/15 via-white/10 to-cyan-100/20 dark:from-violet-400/8 dark:via-transparent dark:to-cyan-400/8 ${isDetail ? "aspect-[4/5] sm:aspect-video" : "aspect-[4/3]"}`}
        >
          <img src={post.image_url} alt={post.title} className="h-full w-full object-cover" />
        </div>
      )}
    </>
  )

  const moreMenu = (
    <button
      type="button"
      className="absolute right-2 top-2 z-10 shrink-0 rounded p-1 hover:bg-secondary"
      aria-label="More options"
    >
      <MoreHorizontal className="h-5 w-5 text-muted-foreground" />
    </button>
  )

  const linkedOrBody = (
    <div className="relative min-w-0">
      {linkToPost ? (
        <Link
          href={postHref}
          className="block min-w-0 rounded-t-2xl text-left outline-none transition-colors hover:bg-secondary/15 focus-visible:ring-2 focus-visible:ring-accent"
        >
          {postBody}
        </Link>
      ) : (
        <div className="min-w-0 rounded-t-2xl">{postBody}</div>
      )}
      {moreMenu}
    </div>
  )

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card flex flex-col overflow-hidden rounded-2xl transition-[box-shadow] hover:shadow-[0_14px_48px_-16px_rgba(15,23,42,0.22)] dark:hover:shadow-[0_18px_56px_-14px_rgba(0,0,0,0.55)]"
    >
      <div className="min-w-0">
        {linkedOrBody}

        <div
          className="flex items-stretch justify-between gap-0.5 border-t border-border/35 px-1.5 py-1.5"
          role="group"
          aria-label="Reactions"
        >
          {POST_REACTIONS.map((r) => {
            const n = counts[r.id]
            const active = selected === r.id
            return (
              <button
                key={r.id}
                type="button"
                disabled={!userId}
                onClick={() => void handleReaction(r.id)}
                title={r.label}
                aria-label={`${r.label}${n ? `, ${n}` : ""}`}
                aria-pressed={active}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[11px] transition-colors ${
                  active
                    ? "bg-accent/20 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                } ${!userId ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className="select-none text-lg leading-none" aria-hidden>
                  {r.emoji}
                </span>
                <span className="tabular-nums leading-none text-[10px] font-medium text-muted-foreground">
                  {n > 99 ? "99+" : n}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-0.5 px-1 py-1.5">
          {linkToPost ? (
            <Link
              href={`${postHref}#comments`}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <MessageSquare className="h-5 w-5" />
              <span className="text-xs font-medium">{post.comments_count}</span>
            </Link>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <MessageSquare className="h-5 w-5" />
              <span className="text-xs font-medium">{post.comments_count}</span>
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-muted-foreground transition-colors hover:bg-secondary"
                aria-label="Share post"
              >
                <Share2 className="h-5 w-5" />
                <span className="hidden text-xs font-medium sm:inline">Share</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[11rem]">
              <DropdownMenuItem onClick={() => void handleShareNative()}>Share…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCopyLink()}>Copy link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePinterest}>Save on Pinterest</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => setIsBookmarked(!isBookmarked)}
            className={`ml-auto rounded-full p-2 transition-colors hover:bg-secondary ${
              isBookmarked ? "text-accent" : "text-muted-foreground"
            }`}
            aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark className={`h-5 w-5 ${isBookmarked ? "fill-current" : ""}`} />
          </button>
        </div>
      </div>
    </motion.article>
  )
}
