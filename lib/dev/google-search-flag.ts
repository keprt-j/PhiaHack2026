/**
 * Dev-only: in-memory toggle so you can pause Gemini + Google Search without editing `.env`.
 * Applies to the local Node process (single-instance `next dev`).
 */

let devDisableGoogleSearch = false

export function getDevGoogleSearchDisabled(): boolean {
  return process.env.NODE_ENV === "development" && devDisableGoogleSearch
}

export function setDevGoogleSearchDisabled(value: boolean): void {
  if (process.env.NODE_ENV !== "development") return
  devDisableGoogleSearch = value
}
