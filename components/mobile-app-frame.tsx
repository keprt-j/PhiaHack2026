"use client"

import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

type MobileAppFrameProps = {
  children: ReactNode
  /** Applied to the inner scroll column (e.g. `overflow-hidden` when a child handles scroll). */
  innerClassName?: string
}

/** Logical 1080×1920 — portrait 9:16 (width : height). */
const PHONE_ASPECT = "9 / 16" as const
const MAX_FRAME_H_PX = 900

/**
 * Centers a fixed 9:16 “device” (same proportions as 1080×1920): tall rectangle, never square.
 */
export function MobileAppFrame({ children, innerClassName = "" }: MobileAppFrameProps) {
  const shellStyle: CSSProperties = {
    aspectRatio: PHONE_ASPECT,
    // Width is the short edge; height is the long edge (like 1080 vs 1920 in portrait).
    width: `min(420px, calc(100vw - 1.5rem), calc(min(92dvh, ${MAX_FRAME_H_PX}px) * 9 / 16))`,
    maxHeight: `min(92dvh, ${MAX_FRAME_H_PX}px)`,
  }

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center bg-background px-3 py-5 md:bg-muted/45 md:py-10 md:px-6">
      <div
        className="pointer-events-none absolute inset-0 hidden md:block bg-[radial-gradient(ellipse_90%_55%_at_50%_18%,color-mix(in_oklch,var(--accent)_10%,transparent),transparent_60%)]"
        aria-hidden
      />

      <div
        className={cn(
          "relative z-10 flex shrink-0 flex-col overflow-hidden rounded-[2rem] border border-border/70 bg-background shadow-[0_32px_100px_-28px_rgba(0,0,0,0.42)] ring-1 ring-black/[0.05] dark:border-border/50 dark:shadow-[0_32px_100px_-24px_rgba(0,0,0,0.65)] dark:ring-white/[0.06] md:rounded-[2.75rem]",
        )}
        style={shellStyle}
      >
        <div
          className="hidden shrink-0 select-none items-center justify-between px-7 pb-1 pt-3 text-[11px] font-medium text-muted-foreground md:flex"
          aria-hidden
        >
          <span className="tracking-wide">9:41</span>
          <div className="h-7 w-[7.25rem] rounded-full bg-foreground/[0.08] dark:bg-foreground/[0.12]" />
          <div className="flex items-center gap-1 opacity-80">
            <span className="text-[10px]">5G</span>
            <div className="flex h-2.5 w-6 items-end justify-end rounded-sm border border-muted-foreground/40 p-px">
              <div className="h-[80%] w-[80%] rounded-[1px] bg-muted-foreground/80" />
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/[0.09] via-transparent to-transparent" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/22 to-transparent md:top-[3.25rem]" aria-hidden />

        <div
          className={cn(
            "relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-[env(safe-area-inset-bottom)]",
            innerClassName,
          )}
        >
          {children}
        </div>

        <div className="hidden shrink-0 justify-center pb-2 pt-1 md:flex" aria-hidden>
          <div className="h-1 w-24 rounded-full bg-foreground/15 dark:bg-foreground/25" />
        </div>
      </div>
    </div>
  )
}
