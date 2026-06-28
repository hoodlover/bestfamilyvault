// Adds the Plaid integration columns to the entries table. Run once:
//   npx tsx --env-file=.env.local scripts/apply-plaid-columns-migration.ts
// Idempotent — IF NOT EXISTS guards on every column.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "plaid_item_id" text`,
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "plaid_access_token" text`,
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "plaid_account_id" text`,
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "plaid_cursor" text`,
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "plaid_synced_at" timestamp`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nPlaid columns added to entry table.')
})()
