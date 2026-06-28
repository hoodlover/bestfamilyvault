// Adds entry.is_recurring boolean and backfills it true for everything
// currently filed under the Subscriptions subcategory.
//
// Idempotent — IF NOT EXISTS guards on the column add, and the backfill
// is just an UPDATE that's safe to re-run.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-recurring.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  await sql`
    ALTER TABLE entry
    ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false
  `
  console.log('Added is_recurring column (or already present).')

  // Find the Subscriptions subcategory under Finance and flag everything
  // already filed there as recurring. New entries created under that
  // subcategory still won't auto-flag — the user opts in via the
  // "recurring bill" toggle on the card.
  const subs = await sql`
    SELECT s.id
    FROM subcategory s
    JOIN category c ON c.id = s.category_id
    WHERE c.slug = 'finance' AND s.name = 'Subscriptions'
  ` as Array<{ id: string }>

  if (subs.length === 0) {
    console.log('No Subscriptions subcategory found — nothing to backfill.')
    return
  }

  const subId = subs[0].id
  const updated = await sql`
    UPDATE entry SET is_recurring = true
    WHERE subcategory_id = ${subId} AND is_recurring = false
    RETURNING id
  ` as Array<{ id: string }>

  console.log(`Backfilled ${updated.length} existing subscription entries as recurring.`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
