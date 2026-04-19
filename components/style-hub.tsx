"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { motion, AnimatePresence } from "framer-motion"
import {
  Flame,
  Clock,
  TrendingUp,
  Sparkles,
  Search,
  Bell,
  User,
  LogOut,
  LayoutGrid,
  Users,
  X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { PostCard } from "./post-card"
import { CommunitySidebar } from "./community-sidebar"
import { Post, Community } from "@/lib/types"
import { authorHandleForPost } from "@/lib/utils"
import Link from "next/link"
import { BrandLogo } from "@/components/brand-logo"
import { HubBottomNav } from "@/components/hub-bottom-nav"
import type { PostReactionId } from "@/lib/post-reactions"

type FeedTab = "all" | "trending" | "new" | "for-you"

type HubView = "feed" | "communities"

interface StyleHubProps {
  posts: Post[]
  communities: Community[]
  userId: string | null
  joinedCommunityIds: string[]
  userStyleTags: string[]
  /** Gemini-generated style brief after onboarding swipes */
  profileBrief?: string | null
}

export function StyleHub({
  posts,
  communities,
  userId,
  joinedCommunityIds,
  userStyleTags,
  profileBrief,
}: StyleHubProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [hubView, setHubView] = useState<HubView>("feed")
  const [activeTab, setActiveTab] = useState<FeedTab>("all")
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  const searchNorm = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])

  const handleCommunitySelect = (slug: string | null) => {
    setSelectedCommunity(slug)
    if (slug) setHubView("feed")
  }
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollMilestonesRef = useRef(0)
  const syncedBatchRef = useRef(0)
  const syncingRef = useRef(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      if (selectedCommunity && post.communities?.slug !== selectedCommunity) {
        return false
      }
      if (!searchNorm) return true
      const author = authorHandleForPost(post.profiles)
      const blob = [
        post.title,
        post.content ?? "",
        ...post.outfit_tags,
        post.communities?.name ?? "",
        post.communities?.slug ?? "",
        author,
      ]
        .join(" ")
        .toLowerCase()
      return blob.includes(searchNorm)
    })
  }, [posts, selectedCommunity, searchNorm])

  const filteredCommunities = useMemo(() => {
    if (!searchNorm) return communities
    return communities.filter((c) => {
      const blob = [c.name, c.slug, c.description ?? ""].join(" ").toLowerCase()
      return blob.includes(searchNorm)
    })
  }, [communities, searchNorm])

  const sortedPosts = [...filteredPosts].sort((a, b) => {
    switch (activeTab) {
      case "all":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case "trending":
        return b.upvotes + b.comments_count - (a.upvotes + a.comments_count)
      case "new":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case "for-you": {
        const aScore = a.outfit_tags.filter((tag) => userStyleTags.includes(tag)).length
        const bScore = b.outfit_tags.filter((tag) => userStyleTags.includes(tag)).length
        return bScore - aScore || b.upvotes - a.upvotes
      }
      default:
        return 0
    }
  })

  const postIdsFingerprint = useMemo(
    () =>
      posts
        .map((p) => p.id)
        .sort()
        .join(","),
    [posts],
  )

  const { data: myReactions } = useSWR(
    userId && postIdsFingerprint ? ["post-votes", userId, postIdsFingerprint] : null,
    async () => {
      const ids = posts.map((p) => p.id)
      if (!ids.length) return new Map<string, PostReactionId>()
      const { data, error } = await supabase
        .from("post_votes")
        .select("post_id, vote_type")
        .eq("user_id", userId!)
        .in("post_id", ids)
      if (error) throw error
      const m = new Map<string, PostReactionId>()
      for (const row of data ?? []) {
        m.set(row.post_id as string, row.vote_type as PostReactionId)
      }
      return m
    },
  )

  const tabs: { id: FeedTab; label: string; icon: typeof Flame }[] = [
    { id: "all", label: "All", icon: LayoutGrid },
    { id: "for-you", label: "For You", icon: Sparkles },
    { id: "trending", label: "Trending", icon: Flame },
    { id: "new", label: "New", icon: Clock },
  ]

  useEffect(() => {
    scrollMilestonesRef.current = 0
    syncedBatchRef.current = 0
  }, [activeTab, selectedCommunity, hubView, searchQuery])

  useEffect(() => {
    if (!userId || hubView !== "feed") return
    const el = scrollContainerRef.current
    if (!el) return

    const syncProfileFromScroll = async (batch: number) => {
      if (syncingRef.current) return
      syncingRef.current = true
      try {
        const sampleTags = [...new Set(sortedPosts.flatMap((p) => p.outfit_tags))].slice(0, 24)
        await fetch("/api/profile/refresh-scroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scrollBatch: batch,
            sampleTags,
          }),
        })
      } catch {
        // Silent refresh: failures should not affect feed UX.
      } finally {
        syncingRef.current = false
      }
    }

    const onScroll = () => {
      const step = Math.max(el.clientHeight * 0.9, 320)
      const milestones = Math.floor(el.scrollTop / step)
      if (milestones <= scrollMilestonesRef.current) return
      scrollMilestonesRef.current = milestones

      const batch = Math.floor(milestones / 5)
      if (batch <= syncedBatchRef.current || batch <= 0) return
      syncedBatchRef.current = batch
      void syncProfileFromScroll(batch)
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [sortedPosts, userId, hubView])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      {/* Feed top bar (mobile-first) */}
      <header className="glass-nav sticky top-0 z-50 shrink-0">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 w-[4.5rem] shrink-0 items-center justify-start sm:w-auto">
            <BrandLogo href={userId ? "/feed" : "/"} variant="compact" />
          </div>

          <h1 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-foreground sm:hidden">
            {hubView === "communities"
              ? "Communities"
              : selectedCommunity
                ? `s/${selectedCommunity}`
                : activeTab === "all"
                  ? "r/all"
                  : "Home"}
          </h1>

          <div className="hidden min-w-0 flex-1 max-w-md sm:block">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Posts, tags, communities, authors…"
                autoComplete="off"
                className="glass-well w-full rounded-full border border-white/30 py-2 pl-9 pr-9 text-sm text-foreground shadow-inner shadow-white/10 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent dark:border-white/10"
                aria-label="Search"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex w-[4.5rem] shrink-0 items-center justify-end gap-0.5 sm:w-auto sm:gap-1">
            <button
              type="button"
              onClick={() => setMobileSearchOpen((o) => !o)}
              className={`rounded-full p-1.5 transition-colors hover:bg-secondary sm:hidden ${
                mobileSearchOpen || searchQuery ? "text-foreground" : "text-muted-foreground"
              }`}
              aria-expanded={mobileSearchOpen}
              aria-label={mobileSearchOpen ? "Close search" : "Search"}
            >
              {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
            </button>
            {userId ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="hidden rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
                <Link
                  href="/profile"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary"
                >
                  <User className="h-3.5 w-3.5 text-secondary-foreground" />
                </Link>
              </>
            ) : (
              <Link
                href="/auth/login"
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>

        {mobileSearchOpen && (
          <div className="border-b border-white/25 px-3 pb-2 dark:border-white/10 sm:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Posts, tags, communities…"
                autoComplete="off"
                autoFocus
                className="glass-well w-full rounded-full border border-white/30 py-2.5 pl-9 pr-9 text-sm text-foreground shadow-inner shadow-white/10 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent dark:border-white/10"
                aria-label="Search"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* Feed vs Communities */}
        <div className="flex border-t border-white/25 px-3 py-2 dark:border-white/10 sm:px-4">
          <div className="mx-auto flex w-full max-w-xl rounded-full border border-white/35 bg-white/40 p-1 shadow-inner shadow-white/15 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.07]">
            <button
              type="button"
              onClick={() => setHubView("feed")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition-colors ${
                hubView === "feed"
                  ? "bg-white/85 text-foreground shadow-md shadow-black/5 dark:bg-white/15 dark:shadow-black/40"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Feed
            </button>
            <button
              type="button"
              onClick={() => setHubView("communities")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition-colors ${
                hubView === "communities"
                  ? "bg-white/85 text-foreground shadow-md shadow-black/5 dark:bg-white/15 dark:shadow-black/40"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Communities
            </button>
          </div>
        </div>

        {/* All / For you / … — only on Feed */}
        {hubView === "feed" && (
          <div className="flex gap-2 overflow-x-auto border-t border-white/25 px-3 py-2 [scrollbar-width:none] dark:border-white/10 sm:px-4 [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}
      </header>

      <div
        ref={scrollContainerRef}
        className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        <main className="min-w-0">
          {hubView === "feed" ? (
            <div>
              {selectedCommunity && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-nav sticky top-0 z-10 border-t-0 px-3 py-2.5 sm:px-4"
                >
                  <div className="mx-auto flex w-full max-w-xl items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-accent" />
                      <span className="text-sm font-medium text-foreground">s/{selectedCommunity}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCommunity(null)}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="mx-auto w-full max-w-xl space-y-3 px-2 pb-3 pt-1 sm:px-3">
                <AnimatePresence mode="popLayout">
                  {sortedPosts.length > 0 ? (
                    sortedPosts.map((post) => (
                      <PostCard
                        key={post.id}
                        post={post}
                        userId={userId}
                        initialReaction={myReactions?.get(post.id) ?? null}
                      />
                    ))
                  ) : searchNorm ? (
                    <div className="glass-card rounded-2xl border-dashed border-white/45 px-4 py-12 text-center dark:border-white/15">
                      <p className="text-sm font-medium text-foreground">No posts match your search</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Try a different keyword or clear the search bar.
                      </p>
                    </div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center px-6 py-16 text-center"
                    >
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/35 bg-white/50 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.08]">
                        <Sparkles className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <h3 className="mb-2 text-lg font-semibold text-foreground">No posts yet</h3>
                      <p className="text-muted-foreground">Be the first to share your style!</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {profileBrief && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card rounded-2xl px-3 py-3"
                  >
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                      <Sparkles className="h-4 w-4 shrink-0 text-accent" />
                      Your style brief
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                      {profileBrief}
                    </p>
                  </motion.div>
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-xl px-2 pb-3 pt-1 sm:px-3">
              <CommunitySidebar
                communities={filteredCommunities}
                joinedCommunityIds={joinedCommunityIds}
                userId={userId}
                onCommunitySelect={handleCommunitySelect}
                selectedCommunity={selectedCommunity}
                searchQuery={searchQuery}
              />
            </div>
          )}
        </main>

      </div>

      <HubBottomNav />
    </div>
  )
}
