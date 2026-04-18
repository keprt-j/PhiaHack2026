import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/admin"

/**
 * Dev-only: delete one row from `outfit_candidates` by id (e.g. bad web-discover image).
 * Disabled outside `NODE_ENV=development`.
 */
export async function DELETE(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const id = new URL(req.url).searchParams.get("id")
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const admin = createServiceClient()
  const { error } = await admin.from("outfit_candidates").delete().eq("id", id.trim())

  if (error) {
    console.warn("[dev/candidate] delete", error.message)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
