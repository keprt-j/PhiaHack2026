"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Layers, Sparkles, Users } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { MobileAppFrame } from "@/components/mobile-app-frame"

export function LandingPage() {
  return (
    <MobileAppFrame innerClassName="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
      <header className="glass-nav sticky top-0 z-50">
        <div className="mx-auto flex max-w-full items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
          <BrandLogo href="/" variant="marketing" />
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/auth/login"
              className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4"
            >
              Sign in
            </Link>
            <Link
              href="/discover"
              className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:px-5"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-border/40 px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,color-mix(in_oklch,var(--accent)_14%,transparent),transparent_55%)]" />
          <div className="relative mx-auto max-w-3xl text-center">
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-accent"
            >
              Your feed, your taste
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl"
            >
              Swipe looks you love. Unlock a feed that actually fits.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground sm:text-xl"
            >
              New here? Scroll through how it works, then start your quick style session. Already have an account?
              Sign in and jump straight to your feed.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4"
            >
              <Link
                href="/discover"
                className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
              >
                Start swiping
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/auth/login"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-full border border-border bg-card px-8 py-4 text-base font-semibold text-foreground transition-colors hover:bg-secondary sm:w-auto"
              >
                Sign in to your feed
              </Link>
            </motion.div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-b border-border/40 px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">How it works</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
              Three quick beats — no endless forms.
            </p>
            <div className="mt-10 grid grid-cols-1 gap-6">
              {[
                {
                  icon: Layers,
                  title: "Swipe real outfits",
                  body: "Like, pass, or super-like looks. We learn from what you engage with — not from a quiz.",
                },
                {
                  icon: Sparkles,
                  title: "Get your style brief",
                  body: "After your session, we summarize your vibe into tags and a profile you can use across the app.",
                },
                {
                  icon: Users,
                  title: "Open your feed",
                  body: "Communities and posts line up with your taste. Sign in anytime to save progress and sync devices.",
                },
              ].map((item, i) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ delay: i * 0.08 }}
                  className="rounded-2xl border border-border/70 bg-card/50 p-6 shadow-sm"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <item.icon className="h-6 w-6" strokeWidth={2} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl rounded-3xl border border-border bg-gradient-to-br from-secondary/80 to-card px-6 py-12 text-center sm:px-10 sm:py-16">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Ready when you are</h2>
            <p className="mt-3 text-muted-foreground">
              Try the swipe deck as a guest, or sign in first to save everything to your account.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/discover"
                className="inline-flex w-full max-w-xs items-center justify-center rounded-full bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
              >
                Get started free
              </Link>
              <Link
                href="/auth/login"
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground sm:text-sm">
        <p>StyleSwipe — discover your style, one swipe at a time.</p>
      </footer>
      </div>
    </MobileAppFrame>
  )
}
