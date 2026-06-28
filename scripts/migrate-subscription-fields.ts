// Add subscription detail columns to entry. All optional — only populated
// when the user fills them in on a recurring entry.
//
// Idempotent (IF NOT EXISTS guards). Safe to re-run.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-subscription-fields.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS subscription_amount_cents integer`
  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS subscription_period text`
  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS subscription_started_at text`
  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS subscription_renews_at text`
  console.log('Added subscription_* columns to entry (or already present).')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
