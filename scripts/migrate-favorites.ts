// One-shot: create entry_favorite + note_favorite tables and backfill
// Lance's existing favorites from the legacy is_favorite columns.
//
// Idempotent — IF NOT EXISTS guards on the table creates, and the backfill
// uses ON CONFLICT DO NOTHING to skip rows that already exist.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-favorites.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const LANCE_USER_ID = '8b207c90-4012-4a2b-9ee7-25f153494414'

async function run() {
  // 1. Create the tables.
  await sql`
    CREATE TABLE IF NOT EXISTS entry_favorite (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      entry_id text NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS entry_fav_user_entry_idx
      ON entry_favorite(user_id, entry_id)
  `
  await sql`CREATE INDEX IF NOT EXISTS entry_fav_user_idx ON entry_favorite(user_id)`

  await sql`
    CREATE TABLE IF NOT EXISTS note_favorite (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      note_id text NOT NULL REFERENCES note(id) ON DELETE CASCADE,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS note_fav_user_note_idx
      ON note_favorite(user_id, note_id)
  `
  await sql`CREATE INDEX IF NOT EXISTS note_fav_user_idx ON note_favorite(user_id)`

  console.log('Tables created (or already existed).')

  // 2. Backfill Lance's favorites from the legacy is_favorite columns.
  // We assume Lance flagged everything that's currently favorited globally —
  // he's the primary user. Other family members start with empty favorites.
  const entryRes = await sql`
    INSERT INTO entry_favorite (id, user_id, entry_id)
    SELECT gen_random_uuid()::text, ${LANCE_USER_ID}, e.id
    FROM entry e
    WHERE e.is_favorite = true
    ON CONFLICT (user_id, entry_id) DO NOTHING
    RETURNING id
  `
  const noteRes = await sql`
    INSERT INTO note_favorite (id, user_id, note_id)
    SELECT gen_random_uuid()::text, ${LANCE_USER_ID}, n.id
    FROM note n
    WHERE n.is_favorite = true
    ON CONFLICT (user_id, note_id) DO NOTHING
    RETURNING id
  `

  console.log(`Backfilled ${entryRes.length} entry favorites and ${noteRes.length} note favorites for Lance.`)
  console.log('Migration complete. Legacy is_favorite columns are still in place — safe to leave them.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
