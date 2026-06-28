// Adds the phone column to the entry table so login / credit-card /
// bank-account / note entries can store a contact number alongside the
// existing fields. Idempotent — re-running is a no-op once the column
// exists.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-entry-phone.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS phone text`
  console.log('entry.phone column added (or already existed). Done.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
