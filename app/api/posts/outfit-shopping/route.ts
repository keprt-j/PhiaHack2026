import { NextResponse } from "next/server"
import { z } from "zod"
import { suggestOutfitShopping } from "@/lib/ai/outfit-shop-gemini"
import { createClient } from "@/lib/supabase/server"

const bodySchema = z.object({
  postId: z.string().uuid(),
})

export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "postId (uuid) required" }, { status: 400 })
  }

  const { postId } = parsed.data
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("posts")
    .select("id, title, content, image_url, outfit_tags")
    .eq("id", postId)
    .maybeSingle()

  if (error || !row) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 })
  }

  const imageUrl = row.image_url as string | null
  if (!imageUrl?.trim()) {
    return NextResponse.json({ error: "This post has no outfit image to analyze." }, { status: 422 })
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "Outfit shopping is not configured (missing GEMINI_API_KEY)." }, { status: 503 })
  }

  const result = await suggestOutfitShopping({
    imageUrl: imageUrl.trim(),
    title: (row.title as string) ?? undefined,
    content: (row.content as string | null) ?? null,
    outfitTags: (row.outfit_tags as string[]) ?? [],
  })

  if (!result) {
    return NextResponse.json(
      { error: "Could not analyze the image. Try again, or use a different image URL." },
      { status: 502 },
    )
  }

  return NextResponse.json({
    source: result.source,
    summary: result.payload.summary,
    pieces: result.payload.pieces,
    links: result.payload.links,
  })
}
