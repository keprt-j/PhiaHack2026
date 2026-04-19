"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { House, Compass, Plus, ShoppingBag, User } from "lucide-react"

/**
 * Shared mobile bottom nav for feed-style shells (home, discover, shop, profile).
 */
export function HubBottomNav() {
  const pathname = usePathname()
  const active = (path: string) => pathname === path

  return (
    <nav
      className="flex shrink-0 items-end justify-around border-t border-white/50 bg-white/[0.22] px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-[28px] backdrop-saturate-[1.65] dark:border-white/[0.14] dark:bg-black/22 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      aria-label="Primary"
    >
      <Link
        href="/feed"
        className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
          active("/feed") ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <House className={`h-6 w-6 ${active("/feed") ? "stroke-[2.5]" : ""}`} />
        <span className="text-[10px] font-medium">Home</span>
      </Link>
      <Link
        href="/discover"
        className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
          pathname === "/discover" || pathname?.startsWith("/discover/")
            ? "text-foreground"
            : "text-muted-foreground"
        }`}
      >
        <Compass
          className={`h-6 w-6 ${pathname === "/discover" || pathname?.startsWith("/discover/") ? "stroke-[2.5]" : ""}`}
        />
        <span className="text-[10px] font-medium">Discover</span>
      </Link>
      <button
        type="button"
        className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-[0_12px_32px_-8px_color-mix(in_oklch,var(--accent)_55%,transparent)]"
        aria-label="Create post"
      >
        <Plus className="h-6 w-6" />
      </button>
      <Link
        href="/shop"
        className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
          active("/shop") ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <ShoppingBag className="h-6 w-6" />
        <span className="text-[10px] font-medium">Shop</span>
      </Link>
      <Link
        href="/profile"
        className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
          active("/profile") ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <User className="h-6 w-6" />
        <span className="text-[10px] font-medium">You</span>
      </Link>
    </nav>
  )
}
