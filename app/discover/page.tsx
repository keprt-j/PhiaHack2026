"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { TasteDiscovery, type ProfileHandoff } from "@/components/taste-discovery"
import { createClient } from "@/lib/supabase/client"

export default function DiscoverPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(false)
  const inProfileMode = searchParams.get("mode") === "profile"

  useEffect(() => {
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      setUserId(user?.id ?? null)
      if (!user?.id) {
        setHasCompletedOnboarding(false)
        return
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("has_completed_onboarding")
        .eq("id", user.id)
        .maybeSingle()
      setHasCompletedOnboarding(Boolean(profile?.has_completed_onboarding))
    })
  }, [supabase])

  const onComplete = useCallback(
    async (_handoff: ProfileHandoff) => {
      if (userId) {
        await supabase.from("profiles").update({ has_completed_onboarding: true }).eq("id", userId)
      }
      router.push("/feed")
      router.refresh()
    },
    [router, supabase, userId],
  )

  return (
    <TasteDiscovery
      userId={userId}
      onComplete={onComplete}
      unlimited={Boolean(userId && hasCompletedOnboarding)}
      onExit={inProfileMode ? () => router.push("/profile") : undefined}
    />
  )
}
