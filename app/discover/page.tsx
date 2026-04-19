"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { ItemSwipeDiscovery } from "@/components/item-swipe-discovery"
import { createClient } from "@/lib/supabase/client"

function DiscoverContent() {
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [userId, setUserId] = useState<string | null>(null)
  const inProfileMode = searchParams.get("mode") === "profile"

  useEffect(() => {
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null)
    })
  }, [supabase])

  const onDeckCompleted = useCallback(async () => {
    if (!userId) return
    await supabase.from("profiles").update({ has_completed_onboarding: true }).eq("id", userId)
  }, [userId, supabase])

  return (
    <div className="relative min-h-0 flex-1">
      {inProfileMode ? (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-[60] flex justify-start px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <Link
            href="/profile"
            className="pointer-events-auto rounded-full border border-white/20 bg-background/90 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur-md dark:border-white/10"
          >
            ← Profile
          </Link>
        </div>
      ) : null}
      <ItemSwipeDiscovery userId={userId} onDeckCompleted={onDeckCompleted} />
    </div>
  )
}

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] flex-1 items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-accent" />
        </div>
      }
    >
      <DiscoverContent />
    </Suspense>
  )
}
