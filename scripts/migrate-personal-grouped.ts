import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  console.log('Running migration...')

  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false`
  console.log('✓ entry.is_personal')

  await sql`ALTER TABLE entry ADD COLUMN IF NOT EXISTS parent_entry_id text`
  console.log('✓ entry.parent_entry_id')

  await sql`ALTER TABLE note ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false`
  console.log('✓ note.is_personal')

  await sql`CREATE INDEX IF NOT EXISTS entry_personal_idx ON entry(is_personal)`
  await sql`CREATE INDEX IF NOT EXISTS entry_parent_idx ON entry(parent_entry_id)`
  await sql`CREATE INDEX IF NOT EXISTS note_personal_idx ON note(is_personal)`
  console.log('✓ indexes')

  console.log('Migration complete.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
