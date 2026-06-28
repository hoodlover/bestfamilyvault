// One-shot: add voice-memo columns to the message table and relax the
// body NOT NULL so voice-only messages are allowed.
//
// Idempotent — IF NOT EXISTS guards make this safe to re-run.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-message-voice.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  await sql`ALTER TABLE message ADD COLUMN IF NOT EXISTS voice_memo_blob_url text`
  await sql`ALTER TABLE message ADD COLUMN IF NOT EXISTS voice_memo_content_type text`
  await sql`ALTER TABLE message ADD COLUMN IF NOT EXISTS voice_memo_duration_sec integer`
  await sql`ALTER TABLE message ALTER COLUMN body DROP NOT NULL`
  console.log('Message table migrated: voice_memo columns added, body now nullable.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
