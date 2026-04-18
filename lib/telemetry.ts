/** Lightweight server-side timing + fallback logging (no external deps). */
export function logApi(
  route: string,
  data: { ok: boolean; latencyMs: number; fallback?: boolean; error?: string },
) {
  const line = `[api] ${route} ${data.ok ? "ok" : "err"} ${data.latencyMs}ms${data.fallback ? " fallback" : ""}${data.error ? ` ${data.error}` : ""}`
  if (data.ok) {
    console.info(line)
  } else {
    console.warn(line)
  }
}
