import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"

const bodySchema = z.object({
  scrollBatch: z.number().int().min(1).max(500),
  sampleTags: z.array(z.string().min(1).max(48)).max(24).default([]),
})

function buildEvolvingBio(tags: string[], scrollBatch: number): string {
  if (!tags.length) {
    return `Taste profile is adapting from feed behavior (checkpoint ${scrollBatch}).`
  }
  return `Evolving style (checkpoint ${scrollBatch}): ${tags.slice(0, 6).join(", ")}.`
}

function buildEvolvingPrompt(tags: string[], scrollBatch: number): string {
  if (!tags.length) {
    return `Style is evolving with each feed checkpoint. Current checkpoint: ${scrollBatch}.`
  }
  return `Your style is shifting toward ${tags.slice(0, 10).join(", ")} based on recent feed scrolling patterns (checkpoint ${scrollBatch}).`
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = bodySchema.parse(await req.json())
    const admin = createServiceClient()

    const { data: profileRow } = await admin
      .from("profiles")
      .select("style_tags")
      .eq("id", user.id)
      .maybeSingle()

    const existingTags = Array.isArray(profileRow?.style_tags)
      ? profileRow.style_tags.filter((t): t is string => typeof t === "string")
      : []

    const mergedTags = [...new Set([...body.sampleTags, ...existingTags])].slice(0, 12)
    const updatedAt = new Date().toISOString()
    const evolvingBio = buildEvolvingBio(mergedTags, body.scrollBatch)
    const evolvingPrompt = buildEvolvingPrompt(mergedTags, body.scrollBatch)

    await admin
      .from("profiles")
      .update({
        bio: evolvingBio,
        style_tags: mergedTags,
        updated_at: updatedAt,
      })
      .eq("id", user.id)

    await admin.from("user_style_profiles").upsert({
      user_id: user.id,
      profile_prompt: evolvingPrompt,
      updated_at: updatedAt,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
