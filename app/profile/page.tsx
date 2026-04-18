"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { User, Sparkles, Loader2, Compass, ArrowRight, House } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { MobileAppFrame } from "@/components/mobile-app-frame"
import type { Profile } from "@/lib/types"
import Link from "next/link"

type StyleProfileRow = {
  profile_prompt: string | null
}

export default function ProfilePage() {
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
        router.replace("/auth/login?next=/profile")
        return
      }
      setUserId(user.id)
      setGate("ok")
    })().catch(() => {
      if (!cancelled) router.replace("/auth/login?next=/profile")
    })
    return () => {
      cancelled = true
    }
  }, [router, supabase])

  const { data: profile } = useSWR<Profile | null>(
    gate === "ok" && userId ? `profile-page-${userId}` : null,
    async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle()
      return data
    },
  )

  const { data: styleProfile } = useSWR<StyleProfileRow | null>(
    gate === "ok" && userId ? `style-profile-page-${userId}` : null,
    async () => {
      const { data } = await supabase
        .from("user_style_profiles")
        .select("profile_prompt")
        .eq("user_id", userId!)
        .maybeSingle()
      return data
    },
  )

  if (gate !== "ok") {
    return (
      <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-20">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-accent" />
          <p className="text-muted-foreground">Loading profile…</p>
        </div>
      </MobileAppFrame>
    )
  }

  return (
    <MobileAppFrame innerClassName="flex min-h-0 flex-1 flex-col !overflow-hidden !pb-0">
      {/* Dedicated scroll region (same pattern as /feed) so long bios / prompts always scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-3 py-4 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <User className="h-5 w-5 text-accent" />
              <h1 className="text-lg font-semibold text-foreground">Your Profile</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {(profile?.display_name || profile?.username || "Anonymous stylist") as string}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {profile?.bio || "Your style bio updates as your feed behavior evolves."}
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <h2 className="font-semibold text-foreground">Adaptive Taste Prompt</h2>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {styleProfile?.profile_prompt || "No adaptive prompt yet."}
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-semibold text-foreground">Current style tags</h2>
            <div className="flex flex-wrap gap-1.5">
              {(profile?.style_tags || []).map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 text-center font-semibold text-foreground">Swipe Through Clothes</h2>
            <p className="mb-6 text-center text-sm text-muted-foreground">
              Keep exploring looks. Your taste profile keeps adapting in the background.
            </p>
            <div className="flex flex-col items-center gap-3">
              <Link
                href="/discover?mode=profile"
                className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20 transition-transform hover:scale-[1.02] hover:opacity-95 active:scale-[0.98]"
                aria-label="Keep swiping"
              >
                <Compass className="h-12 w-12" strokeWidth={1.75} />
              </Link>
              <span className="text-sm font-medium text-foreground">Keep swiping</span>
            </div>
          </section>

          <div className="flex flex-col pb-2">
            <Link
              href="/feed"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <House className="h-5 w-5 text-accent" />
              Go to feed
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </div>
    </MobileAppFrame>
  )
}
