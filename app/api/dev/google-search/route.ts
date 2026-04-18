import { NextResponse } from "next/server"
import { getDevGoogleSearchDisabled, setDevGoogleSearchDisabled } from "@/lib/dev/google-search-flag"

/**
 * Dev-only: toggle Gemini Google Search (grounding) for outfit discovery.
 * Disabled outside `NODE_ENV=development`.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ disabled: getDevGoogleSearchDisabled() })
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const body = (await req.json().catch(() => ({}))) as { disabled?: boolean }
  setDevGoogleSearchDisabled(Boolean(body.disabled))
  return NextResponse.json({ disabled: getDevGoogleSearchDisabled() })
}
