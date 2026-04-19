"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { motion } from "framer-motion"
import { Users, Plus, Check, TrendingUp, Crown, Sparkles, Hash } from "lucide-react"
import { Community } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type RecommendedCommunity = Community & {
  matchScore?: number
  matched_tags?: string[]
}

type RecApi = {
  communities: RecommendedCommunity[]
  source: string
}

interface CommunitySidebarProps {
  communities: Community[]
  joinedCommunityIds: string[]
  userId: string | null
  onCommunitySelect: (slug: string | null) => void
  selectedCommunity: string | null
  /** When set, narrows Recommended matches (name / slug / matched tags). */
  searchQuery?: string
}

export function CommunitySidebar({
  communities,
  joinedCommunityIds,
  userId,
  onCommunitySelect,
  selectedCommunity,
  searchQuery = "",
}: CommunitySidebarProps) {
  const [joinedIds, setJoinedIds] = useState<string[]>(joinedCommunityIds)
  const [browseTab, setBrowseTab] = useState<"recommended" | "all">("recommended")
  const supabase = createClient()

  const { data: recData, isLoading: recLoading } = useSWR<RecApi>(
    "/api/communities/recommended",
    async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error("recommended")
      return res.json()
    },
    { revalidateOnFocus: false },
  )

  const searchNorm = searchQuery.trim().toLowerCase()

  const recommendedList = useMemo(() => {
    const list = recData?.communities ?? []
    if (!searchNorm) return list
    return list.filter((c) => {
      const blob = [c.name, c.slug, c.description ?? "", ...(c.matched_tags ?? [])]
        .join(" ")
        .toLowerCase()
      return blob.includes(searchNorm)
    })
  }, [recData?.communities, searchNorm])

  const handleJoin = async (communityId: string) => {
    if (!userId) return

    if (joinedIds.includes(communityId)) {
      setJoinedIds((prev) => prev.filter((id) => id !== communityId))
      await supabase.from("community_members").delete().eq("user_id", userId).eq("community_id", communityId)
    } else {
      setJoinedIds((prev) => [...prev, communityId])
      await supabase.from("community_members").insert({
        user_id: userId,
        community_id: communityId,
      })
    }
  }

  const sortedCommunities = useMemo(
    () => [...communities].sort((a, b) => b.member_count - a.member_count),
    [communities],
  )
  const topCommunities = sortedCommunities.slice(0, 3)

  const filteredAllCommunities = communities

  const CommunityRow = ({
    community,
    showMatchTags,
    matchTags,
  }: {
    community: Community
    showMatchTags?: boolean
    matchTags?: string[]
  }) => {
    const isJoined = joinedIds.includes(community.id)
    return (
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => onCommunitySelect(community.slug)}
          className={cn(
            "flex flex-1 items-center gap-3 rounded-lg text-left transition-colors",
            selectedCommunity === community.slug ? "text-accent" : "text-foreground hover:text-accent",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
            {community.name.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm">s/{community.slug}</p>
            <p className="text-xs text-muted-foreground">
              {community.member_count.toLocaleString()} members
            </p>
            {showMatchTags && matchTags && matchTags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {matchTags.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-medium text-accent"
                  >
                    <Hash className="h-2.5 w-2.5 opacity-80" />
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleJoin(community.id)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            isJoined
              ? "bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive"
              : "bg-primary text-primary-foreground hover:opacity-90",
          )}
        >
          {isJoined ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" />
              Joined
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Plus className="h-3 w-3" />
              Join
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <aside className="w-full shrink-0">
      <div className="space-y-4">
        {/* Recommended | All */}
        <div className="flex w-full rounded-full border border-white/35 bg-white/35 p-1 shadow-inner shadow-white/10 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.06]">
          <button
            type="button"
            onClick={() => setBrowseTab("recommended")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition-colors",
              browseTab === "recommended"
                ? "bg-white/90 text-foreground shadow-sm dark:bg-white/15 dark:shadow-black/30"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Recommended
          </button>
          <button
            type="button"
            onClick={() => setBrowseTab("all")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition-colors",
              browseTab === "all"
                ? "bg-white/90 text-foreground shadow-sm dark:bg-white/15 dark:shadow-black/30"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Users className="h-3.5 w-3.5" />
            All
          </button>
        </div>

        {browseTab === "recommended" ? (
          <div className="glass-card overflow-hidden rounded-xl">
            <div className="flex items-center gap-2 border-b border-white/35 px-4 py-3 dark:border-white/10">
              <Sparkles className="h-5 w-5 text-accent" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-foreground">For your hashtags</h3>
                <p className="text-[11px] text-muted-foreground">
                  From your profile & Discover swipes, matched to community topics.
                </p>
              </div>
            </div>
            <div className="p-2">
              {recLoading ? (
                <div className="space-y-3 px-3 py-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                        <div className="h-2 w-1/3 animate-pulse rounded bg-muted" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recommendedList.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No recommendations yet. Try{" "}
                  <button
                    type="button"
                    className="font-medium text-accent underline underline-offset-2"
                    onClick={() => setBrowseTab("all")}
                  >
                    browsing all communities
                  </button>{" "}
                  or finish Discover to build your tag profile.
                </p>
              ) : (
                recommendedList.map((c) => (
                  <CommunityRow
                    key={c.id}
                    community={c}
                    showMatchTags
                    matchTags={c.matched_tags}
                  />
                ))
              )}
            </div>
          </div>
        ) : null}

        {browseTab === "all" ? (
          <>
            <div className="glass-card overflow-hidden rounded-xl">
              <div className="flex items-center gap-2 border-b border-white/35 px-4 py-3 dark:border-white/10">
                <Crown className="h-5 w-5 text-accent" />
                <h3 className="font-semibold text-foreground">Top Communities</h3>
              </div>
              <div className="p-2">
                {topCommunities.map((community, index) => (
                  <motion.button
                    key={community.id}
                    type="button"
                    onClick={() => onCommunitySelect(community.slug)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                      selectedCommunity === community.slug
                        ? "border border-accent/30 bg-accent/10"
                        : "hover:bg-secondary",
                    )}
                    whileHover={{ x: 2 }}
                  >
                    <span className="w-6 text-lg font-bold text-muted-foreground">{index + 1}</span>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg font-bold text-secondary-foreground">
                      {community.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-medium text-foreground">s/{community.slug}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {community.member_count.toLocaleString()} members
                      </p>
                    </div>
                    {index === 0 ? <TrendingUp className="h-4 w-4 shrink-0 text-accent" /> : null}
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="glass-card overflow-hidden rounded-xl">
              <div className="border-b border-white/35 px-4 py-3 dark:border-white/10">
                <h3 className="font-semibold text-foreground">Style Communities</h3>
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                {filteredAllCommunities.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No communities match your search. Clear the search bar to see the full list.
                  </p>
                ) : (
                  filteredAllCommunities.map((community) => (
                    <CommunityRow key={community.id} community={community} />
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
