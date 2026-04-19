import Link from "next/link"
import { cn } from "@/lib/utils"

type BrandLogoProps = {
  href?: string
  /** Feed shell: smaller mark + wordmark from `sm` up. */
  variant?: "compact" | "marketing"
  className?: string
}

/**
 * Round, minimal wordmark (Outfit via `--font-brand` on `html`).
 */
export function BrandLogo({ href = "/", variant = "compact", className }: BrandLogoProps) {
  const mark = variant === "compact" ? "h-7 w-7 min-h-7 min-w-7" : "h-8 w-8 min-h-8 min-w-8"
  const markRound = "rounded-full"
  const sText = variant === "compact" ? "text-xs font-semibold" : "text-[13px] font-semibold"
  const wordmark =
    variant === "compact"
      ? "hidden text-[15px] font-medium leading-none tracking-[0.04em] sm:inline sm:text-[16px]"
      : "text-base font-medium leading-none tracking-[0.04em] sm:text-[17px]"

  const inner = (
    <>
      <div className={cn("flex items-center justify-center bg-primary", mark, markRound)}>
        <span className={cn("font-brand text-primary-foreground", sText)}>S</span>
      </div>
      <span className={cn("font-brand text-foreground", wordmark)}>StyleSwipe</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={cn("flex items-center gap-1.5", className)}>
        {inner}
      </Link>
    )
  }
  return <span className={cn("flex items-center gap-1.5", className)}>{inner}</span>
}
