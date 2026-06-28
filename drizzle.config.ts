import { defineConfig } from 'drizzle-kit'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually since drizzle-kit doesn't read it automatically
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && !process.env[key]) process.env[key] = val
  }
} catch {
  // .env.local not present — rely on real env vars
}

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
