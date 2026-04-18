"use client"

import Image from "next/image"
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion"
import { Heart, X, Star, Trash2, TrendingUp } from "lucide-react"
import { Outfit } from "@/lib/types"

interface SwipeCardProps {
  outfit: Outfit
  onSwipe: (direction: "left" | "right" | "super") => boolean
  isTop: boolean
  /** Last committed swipe direction — drives exit animation (buttons + after optimistic pop). */
  commitDirection?: "left" | "right" | "super"
  /** Dev only: delete this row from `outfit_candidates` (see `/api/dev/candidate`). */
  onDevDeleteCandidate?: (candidateId: string) => void
}

/** Internal bookkeeping tags used for ranking — never shown to the user. */
const HIDDEN_TAGS = new Set(["web", "full-look", "discovered", "unsplash-source", "export-ready"])

/** Room to drag; `0` on all sides in Framer clamps movement and fights elastic. */
const DRAG_BOX = 220

function exitForDirection(dir: "left" | "right" | "super") {
  if (dir === "super") {
    return {
      y: -320,
      x: 0,
      opacity: 0,
      transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
    }
  }
  return {
    x: dir === "right" ? 300 : -300,
    y: 0,
    opacity: 0,
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
  }
}

export function SwipeCard({
  outfit,
  onSwipe,
  isTop,
  commitDirection = "right",
  onDevDeleteCandidate,
}: SwipeCardProps) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const rotateZ = useTransform(x, [-200, 200], [-12, 12])
  const likeOpacity = useTransform(x, [0, 90], [0, 1])
  const nopeOpacity = useTransform(x, [-90, 0], [1, 0])
  const superOpacity = useTransform(y, [-90, 0], [1, 0])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const xOffset = info.offset.x
    const yOffset = info.offset.y

    if (yOffset < -100) {
      const accepted = onSwipe("super")
      if (!accepted) {
        x.set(0)
        y.set(0)
      }
    } else if (xOffset > 100) {
      const accepted = onSwipe("right")
      if (!accepted) {
        x.set(0)
        y.set(0)
      }
    } else if (xOffset < -100) {
      const accepted = onSwipe("left")
      if (!accepted) {
        x.set(0)
        y.set(0)
      }
    }
  }

  return (
    <motion.div
      className={
        isTop
          ? "absolute inset-0 cursor-grab touch-none active:cursor-grabbing [contain:layout_paint]"
          : "absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
      }
      style={{ x, y, rotateZ, zIndex: isTop ? 10 : 0 }}
      drag={isTop}
      dragConstraints={{ left: -DRAG_BOX, right: DRAG_BOX, top: -DRAG_BOX, bottom: DRAG_BOX }}
      dragElastic={0.88}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      whileDrag={{ scale: 1.02 }}
      initial={{ scale: isTop ? 1 : 0.96, opacity: isTop ? 1 : 0.72 }}
      animate={{ scale: isTop ? 1 : 0.96, opacity: isTop ? 1 : 0.72 }}
      exit={exitForDirection(commitDirection)}
    >
      <div className="relative h-full w-full overflow-hidden rounded-2xl bg-card shadow-[0_16px_40px_-14px_rgba(0,0,0,0.38)] ring-1 ring-black/[0.05] dark:shadow-[0_18px_44px_-16px_rgba(0,0,0,0.65)] dark:ring-white/[0.07] sm:rounded-[1.35rem]">
        <div className="absolute inset-0">
          <Image
            src={outfit.image_url}
            alt=""
            fill
            unoptimized
            draggable={false}
            priority={isTop}
            sizes="(max-width: 640px) 85vw, 340px"
            className="pointer-events-none select-none object-cover object-center"
          />
        </div>

        {/* Vignette: keep the photo bright in the middle, legible chrome at the bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent" />

        {/* Like Indicator */}
        <motion.div
          className="absolute right-3 top-3 rounded-xl border-2 border-green-400 bg-green-500/15 px-3 py-1.5 shadow-md backdrop-blur-sm sm:right-4 sm:top-4"
          style={{ opacity: likeOpacity }}
        >
          <span className="text-sm font-extrabold tracking-[0.15em] text-green-400">LIKE</span>
        </motion.div>

        {/* Nope Indicator */}
        <motion.div
          className="absolute left-3 top-3 rounded-xl border-2 border-red-400 bg-red-500/15 px-3 py-1.5 shadow-md backdrop-blur-sm sm:left-4 sm:top-4"
          style={{ opacity: nopeOpacity }}
        >
          <span className="text-sm font-extrabold tracking-[0.15em] text-red-400">NOPE</span>
        </motion.div>

        {/* Super Indicator */}
        <motion.div
          className="absolute left-1/2 top-[26%] -translate-x-1/2 rounded-xl border-2 border-accent bg-accent/20 px-3 py-1.5 shadow-md backdrop-blur-sm sm:top-[30%]"
          style={{ opacity: superOpacity }}
        >
          <span className="text-sm font-extrabold tracking-[0.15em] text-accent">SUPER</span>
        </motion.div>

        {/* Trending Badge */}
        {outfit.is_trending && (
          <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground">
            <TrendingUp className="h-4 w-4" />
            Trending
          </div>
        )}

        {process.env.NODE_ENV === "development" && isTop && onDevDeleteCandidate && (
          <button
            type="button"
            className="absolute right-4 top-4 z-20 flex touch-none items-center gap-1 rounded-lg bg-black/55 px-2 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm hover:bg-black/70"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onDevDeleteCandidate(outfit.id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Delete row
          </button>
        )}

        {/* Content — sized for phone-width cards so type doesn’t overpower the photo */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-8 text-card-foreground sm:p-4 sm:pt-10">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {outfit.source_platform && (
                <p className="mb-0.5 text-[9px] uppercase tracking-wider text-white/50">
                  {outfit.source_platform}
                </p>
              )}
              <h3 className="line-clamp-2 text-base font-bold leading-snug tracking-tight text-white drop-shadow-sm sm:text-lg">
                {outfit.title}
              </h3>
              {outfit.brand && <p className="mt-0.5 text-xs font-medium text-white/85">{outfit.brand}</p>}
            </div>
            {outfit.price_range && (
              <span className="shrink-0 self-start rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm sm:text-xs">
                {outfit.price_range}
              </span>
            )}
          </div>

          {outfit.description && (
            <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-white/75">{outfit.description}</p>
          )}

          <div className="flex flex-wrap gap-1">
            {outfit.style_tags
              .filter((t) => !HIDDEN_TAGS.has(t.toLowerCase()))
              .slice(0, 4)
              .map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/90 backdrop-blur-sm"
                >
                  #{tag}
                </span>
              ))}
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/55">
            <Heart className="h-3 w-3 shrink-0" />
            <span>{outfit.likes_count.toLocaleString()} likes</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

interface SwipeButtonsProps {
  onSwipe: (direction: "left" | "right" | "super") => boolean
  /** `rail` = compact vertical stack on the side of the card (mobile-first swipe UI). */
  variant?: "bar" | "rail"
}

export function SwipeButtons({ onSwipe, variant = "bar" }: SwipeButtonsProps) {
  const rail = variant === "rail"
  const btn =
    "flex items-center justify-center rounded-full border transition-transform active:scale-95 disabled:opacity-50"
  const sm = rail ? "h-9 w-9 shadow-sm" : "h-11 w-11 shadow-md sm:h-12 sm:w-12"
  const iconSm = rail ? "h-4 w-4" : "h-6 w-6 sm:h-7 sm:w-7"

  const inner = (
    <>
      <button
        type="button"
        onClick={() => onSwipe("left")}
        className={`${btn} ${sm} border-red-500/30 bg-card/95 hover:border-red-500/50 hover:scale-105 dark:bg-secondary/90`}
        aria-label="Dislike"
      >
        <X className={`${iconSm} text-red-500`} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onSwipe("super")}
        className={`${btn} ${sm} border-accent/40 bg-accent text-accent-foreground shadow-[0_0_16px_color-mix(in_oklch,var(--accent)_35%,transparent)] hover:scale-105`}
        aria-label="Super Like"
      >
        <Star className={`${iconSm} fill-accent-foreground/15`} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onSwipe("right")}
        className={`${btn} ${sm} border-emerald-500/30 bg-card/95 hover:border-emerald-500/50 hover:scale-105 dark:bg-secondary/90`}
        aria-label="Like"
      >
        <Heart className={`${iconSm} fill-green-500/15 text-green-500`} strokeWidth={2} />
      </button>
    </>
  )

  if (rail) {
    return <div className="flex flex-col items-center justify-center gap-2 py-1">{inner}</div>
  }

  return <div className="mx-auto flex max-w-md items-center justify-center gap-5 sm:gap-6">{inner}</div>
}
