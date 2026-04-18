export type UnsplashPhoto = {
  id: string
  urls: { regular: string; raw?: string }
  links: { html: string }
  alt_description: string | null
  description: string | null
}

/**
 * Random editorial-style photos (portrait). Requires Unsplash API access key.
 * @see https://unsplash.com/documentation#get-a-random-photo
 */
export async function fetchUnsplashRandomPhotos(params: {
  count: number
  query?: string
}): Promise<UnsplashPhoto[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim()
  if (!key) {
    throw new Error(
      "UNSPLASH_ACCESS_KEY is not set. Add it to .env.local (free tier: https://unsplash.com/developers )",
    )
  }

  const count = Math.min(30, Math.max(1, params.count))
  const query =
    params.query ?? "fashion outfit editorial streetwear model full body lookbook"

  const url = new URL("https://api.unsplash.com/photos/random")
  url.searchParams.set("count", String(count))
  url.searchParams.set("orientation", "portrait")
  url.searchParams.set("content_filter", "high")
  url.searchParams.set("query", query)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Client-ID ${key}`,
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    const t = await res.text()
    const hint =
      res.status === 401
        ? " Use the Application Access Key from https://unsplash.com/oauth/applications (header: Client-ID <Access Key>). Do not use the Secret access key, a user OAuth token, or a placeholder."
        : ""
    throw new Error(`Unsplash API ${res.status}: ${t.slice(0, 200)}${hint}`)
  }

  const data = (await res.json()) as UnsplashPhoto | UnsplashPhoto[]
  const list = Array.isArray(data) ? data : [data]
  return list
}
