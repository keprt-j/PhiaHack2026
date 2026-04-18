"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Users, Plus, Check, TrendingUp, Crown } from "lucide-react"
import { Community } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"

interface CommunitySidebarProps {
  communities: Community[]
  joinedCommunityIds: string[]
  userId: string | null
  onCommunitySelect: (slug: string | null) => void
  selectedCommunity: string | null
}

export function CommunitySidebar({
  communities,
  joinedCommunityIds,
  userId,
  onCommunitySelect,
  selectedCommunity
}: CommunitySidebarProps) {
  const [joinedIds, setJoinedIds] = useState<string[]>(joinedCommunityIds)
  const supabase = createClient()

  const handleJoin = async (communityId: string) => {
    if (!userId) return

    if (joinedIds.includes(communityId)) {
      // Leave community
      setJoinedIds(prev => prev.filter(id => id !== communityId))
      await supabase
        .from("community_members")
        .delete()
        .eq("user_id", userId)
        .eq("community_id", communityId)
    } else {
      // Join community
      setJoinedIds(prev => [...prev, communityId])
      await supabase.from("community_members").insert({
        user_id: userId,
        community_id: communityId
      })
    }
  }

  const sortedCommunities = [...communities].sort((a, b) => b.member_count - a.member_count)
  const topCommunities = sortedCommunities.slice(0, 3)

  return (
    <aside className="w-full shrink-0">
      <div className="space-y-4">
        {/* Top Communities */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Crown className="w-5 h-5 text-accent" />
            <h3 className="font-semibold text-foreground">Top Communities</h3>
          </div>
          <div className="p-2">
            {topCommunities.map((community, index) => (
              <motion.button
                key={community.id}
                onClick={() => onCommunitySelect(community.slug)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  selectedCommunity === community.slug
                    ? "bg-accent/10 border border-accent/30"
                    : "hover:bg-secondary"
                }`}
                whileHover={{ x: 2 }}
              >
                <span className="text-lg font-bold text-muted-foreground w-6">
                  {index + 1}
                </span>
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg font-bold text-secondary-foreground">
                  {community.name.charAt(0)}
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-foreground text-sm">
                    s/{community.slug}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {community.member_count.toLocaleString()} members
                  </p>
                </div>
                {index === 0 && (
                  <TrendingUp className="w-4 h-4 text-accent" />
                )}
              </motion.button>
            ))}
          </div>
        </div>

        {/* All Communities */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-foreground">Style Communities</h3>
          </div>
          <div className="p-2 max-h-96 overflow-y-auto">
            {communities.map((community) => {
              const isJoined = joinedIds.includes(community.id)
              return (
                <div
                  key={community.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <button
                    onClick={() => onCommunitySelect(community.slug)}
                    className={`flex-1 flex items-center gap-3 rounded-lg transition-colors ${
                      selectedCommunity === community.slug
                        ? "text-accent"
                        : "text-foreground hover:text-accent"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-secondary-foreground">
                      {community.name.charAt(0)}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-sm">s/{community.slug}</p>
                      <p className="text-xs text-muted-foreground">
                        {community.member_count.toLocaleString()} members
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleJoin(community.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      isJoined
                        ? "bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    }`}
                  >
                    {isJoined ? (
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Joined
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Plus className="w-3 h-3" />
                        Join
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}
