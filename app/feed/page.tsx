"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { StyleHub } from "@/components/style-hub"
import { createClient } from "@/lib/supabase/client"
import { Community, Post, Profile } from "@/lib/types"
import { Loader2 } from "lucide-react"
import { outfitCandidateStyleTags } from "@/lib/utils"
import { MobileAppFrame } from "@/components/mobile-app-frame"

export default function FeedPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [gate, setGate] = useState<"checking" | "ok">("checking")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return

      if (!user) {
        router.replace("/auth/login?next=/feed")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("has_completed_onboarding")
        .eq("id", user.id)
        .maybeSingle()

      if (cancelled) return

      if (!profile?.has_completed_onboarding) {
        router.replace("/discover")
        return
      }

      setUserId(user.id)
      setGate("ok")
    })().catch(() => {
      if (!cancelled) router.replace("/auth/login?next=/feed")
    })
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  const { data: communities } = useSWR<Community[]>(
    gate === "ok" ? "communities" : null,
    async () => {
      const { data } = await supabase.from("communities").select("*").order("member_count", { ascending: false })
      return data || []
    },
  )

  const { data: posts } = useSWR<Post[]>(
    gate === "ok" ? ["posts", 120] : null,
    async () => {
      const { data: postRows, error: postErr } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(120)
      if (postErr || !postRows?.length) return []

      const userIds = [...new Set(postRows.map((p) => p.user_id).filter(Boolean))]
      const communityIds = [...new Set(postRows.map((p) => p.community_id).filter(Boolean))]

      const [{ data: profiles }, { data: postCommunities }] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("id, display_name, avatar_url, username").in("id", userIds)
          : Promise.resolve({ data: [] }),
        communityIds.length
          ? supabase.from("communities").select("id, name, slug").in("id", communityIds)
          : Promise.resolve({ data: [] }),
      ])

      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))
      const communityById = new Map((postCommunities ?? []).map((c) => [c.id, c]))

      return postRows.map((p) => ({
        ...p,
        profiles: profileById.get(p.user_id) ?? null,
        communities: p.community_id ? (communityById.get(p.community_id) ?? null) : null,
      })) as Post[]
    },
  )

  const { data: joinedCommunities } = useSWR<string[]>(
    gate === "ok" && userId ? `joined-${userId}` : null,
    async () => {
      const { data } = await supabase.from("community_members").select("community_id").eq("user_id", userId!)
      return data?.map((m) => m.community_id) || []
    },
  )

  const { data: userProfile } = useSWR<Profile | null>(
    gate === "ok" && userId ? `profile-${userId}` : null,
    async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId!).single()
      return data
    },
  )

  const { data: userStyleTags } = useSWR<string[]>(
    gate === "ok" && userId ? `style-tags-${userId}` : null,
    async () => {
      const { data } = await supabase
        .from("swipes")
        .select("outfit_candidates ( style_tags )")
        .eq("user_id", userId!)
        .neq("direction", "left")

      const tags = data?.flatMap((s) => outfitCandidateStyleTags(s.outfit_candidates)) ?? []
      return [...new Set(tags)]
    },
  )

  const { data: profileBrief } = useSWR<string | null>(
    gate === "ok" && userId ? `style-brief-${userId}` : null,
    async () => {
      const { data } = await supabase
        .from("user_style_profiles")
        .select("profile_prompt")
        .eq("user_id", userId!)
        .maybeSingle()
      return data?.profile_prompt?.trim() || null
    },
  )

  if (gate !== "ok" || !userId) {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading your feed…</p>
        </div>
      </MobileAppFrame>
    )
  }

  return (
    <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
      <StyleHub
        posts={posts || []}
        communities={communities || []}
        userId={userId}
        joinedCommunityIds={joinedCommunities || []}
        userStyleTags={userStyleTags || userProfile?.style_tags || []}
        profileBrief={profileBrief ?? undefined}
      />
    </MobileAppFrame>
  )
}
