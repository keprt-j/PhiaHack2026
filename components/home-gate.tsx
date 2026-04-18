"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"
import { LandingPage } from "@/components/landing-page"
import { MobileAppFrame } from "@/components/mobile-app-frame"

/**
 * `/` — marketing for signed-out users; signed-in users go to feed or discover.
 */
export function HomeGate() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<"loading" | "landing">("loading")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return

      if (!user) {
        setState("landing")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("has_completed_onboarding")
        .eq("id", user.id)
        .maybeSingle()

      if (cancelled) return

      if (profile?.has_completed_onboarding) {
        router.replace("/feed")
      } else {
        router.replace("/discover")
      }
    })().catch(() => {
      if (!cancelled) setState("landing")
    })
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  if (state === "loading") {
    return (
      <MobileAppFrame innerClassName="flex flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </MobileAppFrame>
    )
  }

  return <LandingPage />
}
