"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  Flame,
  Clock,
  TrendingUp,
  Sparkles,
  Plus,
  Search,
  Bell,
  User,
  LogOut,
  House,
  Compass,
  MessageCircle,
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
  const pathname = usePathname()
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

  const tabs: { id: FeedTab; label: string; icon: typeof Flame }[] = [
    { id: "all", label: "All", icon: LayoutGrid },
    { id: "for-you", label: "For You", icon: Sparkles },
    { id: "trending", label: "Trending", icon: Flame },
    { id: "new", label: "New", icon: Clock },
  ]

  const navActive = (path: string) => pathname === path

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Reddit-style top bar (mobile-first) */}
      <header className="sticky top-0 z-50 shrink-0 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <div className="flex min-w-0 w-[4.5rem] shrink-0 items-center justify-start sm:w-auto">
            <Link href={userId ? "/feed" : "/"} className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                <span className="text-sm font-bold text-primary-foreground">S</span>
              </div>
              <span className="hidden text-[17px] font-bold tracking-tight text-foreground sm:inline">
                StyleSwipe
              </span>
            </Link>
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
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Posts, tags, communities, authors…"
                autoComplete="off"
                className="w-full rounded-full border-none bg-secondary py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Search"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex w-[4.5rem] shrink-0 items-center justify-end gap-0.5 sm:w-auto sm:gap-1">
            <button
              type="button"
              onClick={() => setMobileSearchOpen((o) => !o)}
              className={`rounded-full p-2 transition-colors hover:bg-secondary sm:hidden ${
                mobileSearchOpen || searchQuery ? "text-foreground" : "text-muted-foreground"
              }`}
              aria-expanded={mobileSearchOpen}
              aria-label={mobileSearchOpen ? "Close search" : "Search"}
            >
              {mobileSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
            </button>
            {userId ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="hidden rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:block"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-5 w-5" />
                </button>
                <Link
                  href="/profile"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary"
                >
                  <User className="h-4 w-4 text-secondary-foreground" />
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
          <div className="border-b border-border/60 px-3 pb-2 sm:hidden">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Posts, tags, communities…"
                autoComplete="off"
                autoFocus
                className="w-full rounded-full border-none bg-secondary py-2.5 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Search"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {/* Feed vs Communities */}
        <div className="flex border-t border-border/60 px-3 py-2 sm:px-4">
          <div className="mx-auto flex w-full max-w-xl rounded-full bg-secondary/80 p-1 ring-1 ring-border/60">
            <button
              type="button"
              onClick={() => setHubView("feed")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition-colors ${
                hubView === "feed"
                  ? "bg-background text-foreground shadow-sm"
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
                  ? "bg-background text-foreground shadow-sm"
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
          <div className="flex gap-2 overflow-x-auto border-t border-border/60 px-3 py-2 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
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
                  className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-sm sm:px-4"
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
                    sortedPosts.map((post) => <PostCard key={post.id} post={post} userId={userId} />)
                  ) : searchNorm ? (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
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
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
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
                    className="rounded-2xl border border-border bg-muted/40 px-3 py-3"
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
              {filteredCommunities.length === 0 && searchNorm ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No communities match your search</p>
                  <p className="mt-1 text-xs text-muted-foreground">Try another name or clear the search bar.</p>
                </div>
              ) : (
                <CommunitySidebar
                  communities={filteredCommunities}
                  joinedCommunityIds={joinedCommunityIds}
                  userId={userId}
                  onCommunitySelect={handleCommunitySelect}
                  selectedCommunity={selectedCommunity}
                />
              )}
            </div>
          )}
        </main>

      </div>

      {/* Reddit-style bottom nav (mobile shell) */}
      <nav
        className="flex shrink-0 items-end justify-around border-t border-border bg-background/95 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden"
        aria-label="Primary"
      >
        <Link
          href="/feed"
          className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
            navActive("/feed") ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <House className={`h-6 w-6 ${navActive("/feed") ? "stroke-[2.5]" : ""}`} />
          <span className="text-[10px] font-medium">Home</span>
        </Link>
        <Link
          href="/discover"
          className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
            navActive("/discover") ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <Compass className="h-6 w-6" />
          <span className="text-[10px] font-medium">Discover</span>
        </Link>
        <button
          type="button"
          className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-md"
          aria-label="Create post"
        >
          <Plus className="h-6 w-6" />
        </button>
        <button
          type="button"
          className="flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 text-muted-foreground"
          aria-label="Inbox"
        >
          <MessageCircle className="h-6 w-6" />
          <span className="text-[10px] font-medium">Inbox</span>
        </button>
        <Link
          href="/profile"
          className={`flex min-w-[3.5rem] flex-col items-center gap-0.5 pb-1 ${
            navActive("/profile") ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          <User className="h-6 w-6" />
          <span className="text-[10px] font-medium">You</span>
        </Link>
      </nav>
    </div>
  )
}
