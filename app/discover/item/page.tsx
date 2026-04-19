import { redirect } from "next/navigation"

/** Legacy URL — discover is item-first at `/discover`. */
export default function DiscoverItemRedirectPage() {
  redirect("/discover")
}
