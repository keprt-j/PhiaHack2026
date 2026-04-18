"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/** Split long copy into bite-sized sticky notes (sentences / paragraphs). */
export function splitProfileIntoNotes(text: string, maxNotes = 5): string[] {
  const t = text.trim()
  if (!t) return []
  const byPara = t.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
  if (byPara.length >= 2) return byPara.slice(0, maxNotes)
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 8)
  const out: string[] = []
  let buf = ""
  for (const s of sentences) {
    if ((buf + s).length > 220 && buf) {
      out.push(buf.trim())
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
    if (out.length >= maxNotes - 1) break
  }
  if (buf) out.push(buf.trim())
  return out.slice(0, maxNotes)
}

type NoteProps = {
  text: string
  index: number
}

function StickyNote({ text, index }: NoteProps) {
  const [open, setOpen] = useState(index === 0)

  const rot = useMemo(() => (index % 3 === 0 ? -1.2 : index % 3 === 1 ? 0.8 : -0.4), [index])

  return (
    <motion.div
      layout
      style={{ rotate: rot }}
      className="relative w-full max-w-lg"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-start gap-2 rounded-sm border border-amber-900/10 bg-[#fff8dc] px-4 py-3 text-left shadow-md transition-shadow dark:border-amber-100/10 dark:bg-[#2a2618]",
          "hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent/50",
        )}
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-[10px] font-bold text-amber-900 dark:bg-amber-700/50 dark:text-amber-100">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-100/70">
              Note
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-amber-900/50 transition-transform dark:text-amber-100/50", open && "rotate-180")}
            />
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.p
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-2 overflow-hidden text-sm leading-relaxed text-amber-950 dark:text-amber-50/95"
              >
                {text}
              </motion.p>
            )}
          </AnimatePresence>
          {!open && (
            <p className="mt-1 line-clamp-2 text-sm text-amber-950/80 dark:text-amber-50/80">{text}</p>
          )}
        </div>
      </button>
    </motion.div>
  )
}

type BlockProps = {
  styleName: string
  notes: string[]
}

export function StyleProfileReveal({ styleName, notes }: BlockProps) {
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-8">
      <motion.h2
        initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="text-center text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl"
      >
        {styleName}
      </motion.h2>

      <div className="flex w-full flex-col gap-4">
        {notes.map((text, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.08, duration: 0.45 }}
          >
            <StickyNote text={text} index={i} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
