"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowUp, ArrowDown, MessageSquare, Share2, Bookmark, MoreHorizontal } from "lucide-react"
import { Post } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { authorHandleForPost, formatDistanceToNow } from "@/lib/utils"

interface PostCardProps {
  post: Post
  userId: string | null
  initialVote?: "up" | "down" | null
  /** When true (default), title/body/image navigate to `/post/[id]`. */
  linkToPost?: boolean
  /** `detail` shows full body text and slightly larger title (post page). */
  variant?: "feed" | "detail"
}

export function PostCard({
  post,
  userId,
  initialVote = null,
  linkToPost = true,
  variant = "feed",
}: PostCardProps) {
  const [voteState, setVoteState] = useState<"up" | "down" | null>(initialVote)
  const [upvotes, setUpvotes] = useState(post.upvotes)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const supabase = createClient()

  const handleVote = async (type: "up" | "down") => {
    if (!userId) return

    const newVote = voteState === type ? null : type

    if (voteState === "up") setUpvotes((prev) => prev - 1)
    if (voteState === "down") setUpvotes((prev) => prev + 1)
    if (newVote === "up") setUpvotes((prev) => prev + 1)
    if (newVote === "down") setUpvotes((prev) => prev - 1)
    setVoteState(newVote)

    if (newVote) {
      await supabase.from("post_votes").upsert(
        {
          user_id: userId,
          post_id: post.id,
          vote_type: newVote,
        },
        {
          onConflict: "user_id,post_id",
        },
      )
    } else {
      await supabase.from("post_votes").delete().eq("user_id", userId).eq("post_id", post.id)
    }
  }

  const postHref = `/post/${post.id}`
  const isDetail = variant === "detail"

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
          <div className={`relative bg-secondary ${isDetail ? "aspect-[4/5] sm:aspect-video" : "aspect-[4/3]"}`}>
            <img
              src={post.image_url}
              alt={post.title}
              className="h-full w-full object-cover"
            />
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
          className="block min-w-0 rounded-r-2xl text-left outline-none transition-colors hover:bg-secondary/15 focus-visible:ring-2 focus-visible:ring-accent"
        >
          {postBody}
        </Link>
      ) : (
        <div className="min-w-0 rounded-r-2xl">{postBody}</div>
      )}
      {moreMenu}
    </div>
  )

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-border/50 transition-shadow hover:shadow-md"
    >
      {/* Reddit-style vote rail (mobile-first) */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-border/80 bg-secondary/30 py-2.5">
        <button
          type="button"
          onClick={() => handleVote("up")}
          className={`rounded p-1 transition-colors ${
            voteState === "up" ? "text-accent" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
          aria-label="Upvote"
        >
          <ArrowUp className="h-6 w-6" />
        </button>
        <span
          className={`min-w-[1.5rem] text-center text-xs font-semibold tabular-nums ${
            voteState === "up" ? "text-accent" : voteState === "down" ? "text-destructive" : "text-foreground"
          }`}
        >
          {upvotes}
        </span>
        <button
          type="button"
          onClick={() => handleVote("down")}
          className={`rounded p-1 transition-colors ${
            voteState === "down"
              ? "text-destructive"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
          aria-label="Downvote"
        >
          <ArrowDown className="h-6 w-6" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {linkedOrBody}

        {/* Row actions (no duplicate votes — Reddit mobile) */}
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
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Share2 className="h-5 w-5" />
            <span className="hidden text-xs font-medium sm:inline">Share</span>
          </button>
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
