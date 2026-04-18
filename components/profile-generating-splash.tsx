"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"

/**
 * Full-screen “final stretch” moment before the profile JSON returns.
 */
export function ProfileGeneratingSplash() {
  const [fake, setFake] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setFake((p) => {
        if (p >= 94) return p
        return p + Math.random() * 7 + 2
      })
    }, 180)
    return () => clearInterval(id)
  }, [])

  const pct = Math.min(100, Math.round(fake))

  return (
    <div className="relative flex min-h-[min(100%,70vh)] flex-1 flex-col items-center justify-center overflow-hidden bg-background px-6 py-8">
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/15 blur-3xl"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.65, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
          animate={{ x: [0, -20, 0], y: [0, -10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-accent/20"
            style={{
              width: 6 + i * 3,
              height: 6 + i * 3,
              left: `${15 + i * 18}%`,
              top: `${20 + (i % 3) * 22}%`,
            }}
            animate={{ y: [0, -14, 0], opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2.2 + i * 0.2, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md text-center"
      >
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Brewing your style DNA
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Matching swipes to silhouettes, palettes, and communities…
        </p>

        <div className="mt-10 h-3 w-full overflow-hidden rounded-full bg-secondary/80">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent via-primary to-accent"
            style={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          />
        </div>
        <p className="mt-3 font-mono text-xs tabular-nums text-muted-foreground">{pct}%</p>
      </motion.div>
    </div>
  )
}
