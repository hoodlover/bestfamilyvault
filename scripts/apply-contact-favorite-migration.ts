// Adds is_favorite boolean to gmail_contact so contacts can be starred
// and floated to the top of /contacts. Local-only — Google's People API
// has no equivalent flag, so this never round-trips on sync.
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-contact-favorite-migration.ts
//
// Idempotent — guarded by IF NOT EXISTS.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `ALTER TABLE "gmail_contact"
    ADD COLUMN IF NOT EXISTS "is_favorite" boolean DEFAULT false NOT NULL`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\ngmail_contact.is_favorite added.')
})()
