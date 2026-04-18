"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { PostCard } from "@/components/post-card"
import { GetTheOutfit } from "@/components/get-the-outfit"
import { MobileAppFrame } from "@/components/mobile-app-frame"
import type { Community, Post, Profile } from "@/lib/types"

export default function PostDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = typeof params.id === "string" ? params.id : ""
  const supabase = useMemo(() => createClient(), [])

  const [userId, setUserId] = useState<string | null>(null)
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!cancelled) setUserId(user?.id ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    if (!id) {
      setError("Invalid post")
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data: row, error: qErr } = await supabase.from("posts").select("*").eq("id", id).maybeSingle()
        if (cancelled) return
        if (qErr || !row) {
          setError("Post not found")
          setPost(null)
          return
        }

        const uid = row.user_id as string
        const cid = row.community_id as string | null

        const [{ data: prof }, { data: comm }] = await Promise.all([
          supabase.from("profiles").select("id, display_name, avatar_url, username").eq("id", uid).maybeSingle(),
          cid
            ? supabase.from("communities").select("id, name, slug").eq("id", cid).maybeSingle()
            : Promise.resolve({ data: null }),
        ])

        if (cancelled) return

        setPost({
          ...(row as Post),
          profiles: (prof ?? null) as Profile | undefined,
          communities: (comm ?? null) as Community | undefined,
        })
      } catch {
        if (!cancelled) setError("Could not load post")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, supabase])

  if (loading) {
    return (
      <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-20">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading post…</p>
        </div>
      </MobileAppFrame>
    )
  }

  if (error || !post) {
    return (
      <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center">
          <p className="text-destructive">{error ?? "Not found"}</p>
          <button
            type="button"
            onClick={() => router.push("/feed")}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Back to feed
          </button>
        </div>
      </MobileAppFrame>
    )
  }

  return (
    <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Link
            href="/feed"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Feed
          </Link>
        </header>

        <div className="mx-auto w-full max-w-xl flex-1 px-2 py-3 sm:px-3">
          <PostCard post={post} userId={userId} linkToPost={false} variant="detail" />
          <div id="outfit-shop" className="mt-6 scroll-mt-24">
            <GetTheOutfit postId={post.id} hasImage={Boolean(post.image_url?.trim())} />
          </div>
        </div>
      </div>
    </MobileAppFrame>
  )
}
