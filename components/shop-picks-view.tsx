"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import Image from "next/image"
import { Loader2, Search, ShoppingBag, Sparkles, FlaskConical } from "lucide-react"
import type { Outfit } from "@/lib/types"
import { BrandLogo } from "@/components/brand-logo"

type ShopPicksResponse = {
  outfits: Outfit[]
  userTags: string[]
  source: string
  error?: string
}

async function fetchShopPicks(url: string): Promise<ShopPicksResponse> {
  const res = await fetch(url)
  const data = (await res.json()) as ShopPicksResponse & { error?: string }
  if (!res.ok) throw new Error(data.error || "Could not load picks")
  return data
}

function googleShopSearchUrl(outfit: Outfit): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(
    [outfit.title, outfit.brand].filter(Boolean).join(" "),
  )}`
}

function OutfitShopCard({ outfit }: { outfit: Outfit }) {
  const shopUrl = outfit.source_url?.trim() || null
  const hasShop = Boolean(shopUrl)
  const googleUrl = googleShopSearchUrl(outfit)

  return (
    <article className="glass-card overflow-hidden rounded-2xl">
      <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-secondary/40 to-muted/30">
        <Image
          src={outfit.image_url}
          alt={outfit.title}
          fill
          className="object-cover"
          sizes="(max-width: 640px) 50vw, 33vw"
          unoptimized
        />
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold leading-tight text-foreground" title={outfit.title}>
            {outfit.title}
          </h3>
          {(outfit.brand || outfit.price_range) && (
            <p
              className="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={[outfit.brand, outfit.price_range].filter(Boolean).join(" · ")}
            >
              {[outfit.brand, outfit.price_range].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {outfit.style_tags.length > 0 && (
          <div className="flex min-w-0 gap-1 overflow-hidden">
            {outfit.style_tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="max-w-[45%] shrink truncate rounded-full bg-secondary/80 px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground"
                title={tag}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        {hasShop ? (
          <div className="flex flex-col gap-1.5 pt-0.5">
            <a
              href={shopUrl!}
              target="_blank"
              rel="noopener noreferrer"
              title="Shop"
              aria-label="Open retailer"
              className="flex h-9 w-full items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              <ShoppingBag className="h-4 w-4" />
            </a>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Google Shopping"
              aria-label="Google Shopping"
              className="flex h-8 w-full items-center justify-center rounded-full border border-border/80 bg-muted/20 text-muted-foreground transition-colors hover:bg-secondary/60"
            >
              <Search className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : (
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Google Shopping"
            aria-label="Google Shopping"
            className="mt-0.5 flex h-9 w-full items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Search className="h-4 w-4" />
          </a>
        )}
      </div>
    </article>
  )
}

type Tab = "for-you" | "demo"

export function ShopPicksView({
  profileBrief,
  userStyleTags,
}: {
  profileBrief?: string | null
  userStyleTags: string[]
}) {
  const [tab, setTab] = useState<Tab>("for-you")

  const key = tab === "demo" ? "/api/shop-picks?demo=1" : "/api/shop-picks"
  const { data, error, isLoading } = useSWR<ShopPicksResponse>(key, fetchShopPicks, {
    revalidateOnFocus: false,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <header className="glass-nav sticky top-0 z-50 shrink-0 border-b border-white/25 px-3 py-2.5 dark:border-white/10 sm:px-4">
        <div className="mx-auto flex max-w-7xl items-center justify-center">
          <BrandLogo href="/feed" variant="compact" />
        </div>

        <div className="mx-auto mt-2.5 flex max-w-xs rounded-full border border-white/35 bg-white/40 p-1 shadow-inner dark:border-white/10 dark:bg-white/[0.07]">
          <button
            type="button"
            onClick={() => setTab("for-you")}
            aria-label="For you"
            title="For you"
            className={`flex flex-1 items-center justify-center rounded-full py-2 transition-colors ${
              tab === "for-you"
                ? "bg-white/85 text-foreground shadow-md dark:bg-white/15"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setTab("demo")}
            aria-label="Demo"
            title="Demo"
            className={`flex flex-1 items-center justify-center rounded-full py-2 transition-colors ${
              tab === "demo"
                ? "bg-white/85 text-foreground shadow-md dark:bg-white/15"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FlaskConical className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(5rem,env(safe-area-inset-bottom))] sm:px-4">
        {tab === "for-you" && profileBrief ? (
          <div className="glass-card mb-3 rounded-2xl px-3 py-2.5">
            <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{profileBrief}</p>
          </div>
        ) : null}

        {tab === "for-you" && userStyleTags.length > 0 && (
          <div className="mb-3 flex min-w-0 flex-wrap gap-1">
            {userStyleTags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="max-w-[40%] truncate rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent-foreground"
                title={tag}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-9 w-9 animate-spin text-accent" />
          </div>
        )}

        {error && (
          <div className="glass-card rounded-2xl border border-destructive/30 px-4 py-6 text-center">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Something went wrong"}</p>
          </div>
        )}

        {!isLoading && data?.outfits && data.outfits.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {data.outfits.map((o) => (
              <OutfitShopCard key={o.id} outfit={o} />
            ))}
          </div>
        )}

        {!isLoading && data?.outfits?.length === 0 && (
          <div className="glass-card rounded-2xl px-4 py-10 text-center">
            <p className="line-clamp-2 text-sm text-muted-foreground">Nothing here yet — swipe on Discover or open Demo.</p>
            <Link
              href="/discover"
              className="mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              Discover
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
