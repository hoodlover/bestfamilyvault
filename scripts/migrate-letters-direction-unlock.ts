// Adds two nullable columns to the letter table:
//   - direction (text, default 'gift'):
//       'gift'    = legacy / parent-to-kid letters (release-gated)
//       'note-to' = kid-to-parent or any direct private letter
//                   (only sender + recipient see it)
//   - unlock_at (timestamp): if set + in future, letter is hidden from
//                            recipient until that date (sender + superuser
//                            still see the locked card with a label).
//
// Idempotent — safe to re-run.

import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  await sql`
    ALTER TABLE "letter"
    ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'gift'
  `
  console.log("✓ letter.direction added (default 'gift')")

  await sql`
    ALTER TABLE "letter"
    ADD COLUMN IF NOT EXISTS "unlock_at" timestamp
  `
  console.log('✓ letter.unlock_at added')

  console.log('\nDone. Existing rows default direction=gift (release-gated).')
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
