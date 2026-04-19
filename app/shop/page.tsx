"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { createClient } from "@/lib/supabase/client"
import { MobileAppFrame } from "@/components/mobile-app-frame"
import { ShopPicksView } from "@/components/shop-picks-view"
import { HubBottomNav } from "@/components/hub-bottom-nav"
import { Loader2 } from "lucide-react"
import type { Profile } from "@/lib/types"
import { outfitCandidateStyleTags } from "@/lib/utils"

export default function ShopPage() {
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
        router.replace("/auth/login?next=/shop")
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
      if (!cancelled) router.replace("/auth/login?next=/shop")
    })
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  const { data: userProfile } = useSWR<Profile | null>(
    gate === "ok" && userId ? `profile-${userId}` : null,
    async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId!).single()
      return data
    },
  )

  const { data: userStyleTags } = useSWR<string[]>(
    gate === "ok" && userId ? `style-tags-shop-${userId}` : null,
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
    gate === "ok" && userId ? `style-brief-shop-${userId}` : null,
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
          <p className="text-muted-foreground">Loading shop…</p>
        </div>
      </MobileAppFrame>
    )
  }

  const mergedTags = [...new Set([...(userStyleTags || []), ...(userProfile?.style_tags || [])])]

  return (
    <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
      <ShopPicksView profileBrief={profileBrief ?? undefined} userStyleTags={mergedTags} />
      <HubBottomNav />
    </MobileAppFrame>
  )
}
