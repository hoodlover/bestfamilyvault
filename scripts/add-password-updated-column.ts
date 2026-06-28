// Adds the password_updated_at column to entry. Idempotent — checks
// information_schema first and skips if already present. Used when
// drizzle-kit push gets stuck on the unrelated dup-index warning.
//
// Run with: npx tsx --env-file=.env.local scripts/add-password-updated-column.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const exists = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='entry' AND column_name='password_updated_at'
  `) as Array<{ column_name: string }>
  if (exists.length > 0) {
    console.log('password_updated_at already exists. Skipping.')
    return
  }
  await sql`ALTER TABLE entry ADD COLUMN password_updated_at TIMESTAMP`
  console.log('+ Added column entry.password_updated_at (TIMESTAMP, NULL)')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
