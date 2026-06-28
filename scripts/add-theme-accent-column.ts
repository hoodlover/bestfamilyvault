// Idempotently adds the user.theme_accent column (text default 'forest')
// without relying on drizzle-kit push, which has stalled on a duplicate-
// index warning in prior sessions. Backfills existing rows to 'forest'.

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'theme_accent'
  `) as Array<{ column_name: string }>

  if (cols.length === 0) {
    await sql`ALTER TABLE "user" ADD COLUMN theme_accent TEXT NOT NULL DEFAULT 'forest'`
    console.log('+ Added column user.theme_accent (default forest)')
  } else {
    console.log('· user.theme_accent already exists')
  }

  // Defensive backfill — covers the case where the column existed but rows
  // somehow ended up NULL (e.g. column added in a prior session without
  // the NOT NULL DEFAULT).
  const updated = (await sql`
    UPDATE "user" SET theme_accent = 'forest' WHERE theme_accent IS NULL RETURNING id
  `) as Array<{ id: string }>
  if (updated.length > 0) console.log(`+ Backfilled ${updated.length} NULL rows to 'forest'`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
