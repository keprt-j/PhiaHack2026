import fs from "fs/promises"
import path from "path"

const DIR = path.join(process.cwd(), "data", "style-profiles")

export async function writeStyleProfileFile(sessionId: string, payload: unknown): Promise<void> {
  await fs.mkdir(DIR, { recursive: true })
  const filePath = path.join(DIR, `${sessionId}.json`)
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8")
}
