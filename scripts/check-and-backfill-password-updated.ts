// One-shot: verify the password_updated_at column exists and backfill
// existing login rows that have a password — copying their updated_at
// over to password_updated_at so the UI shows something instead of "—"
// for legacy entries. Idempotent; safe to re-run.

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='entry' AND column_name='password_updated_at'
  `) as Array<{ column_name: string }>
  if (cols.length === 0) {
    console.error('password_updated_at column not found — run `npm run db:push` first.')
    process.exit(1)
  }
  console.log('✓ password_updated_at column present')

  // Only stamp rows where the column is currently NULL — once a real
  // value is there, don't blast it with the entry's general updatedAt.
  const result = (await sql`
    UPDATE entry
    SET password_updated_at = updated_at
    WHERE type = 'login'
      AND password IS NOT NULL
      AND password_updated_at IS NULL
    RETURNING id
  `) as Array<{ id: string }>
  console.log(`Backfilled ${result.length} login row(s).`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
