// Create the quick_pick_item table that backs the editable staples
// list on /meal-plan/quick-pick. The seeder runs lazily inside the
// app (ensureQuickPickSeeded() on first page render) so this script
// only needs to create the table + index. Idempotent.
//
// Run:
//   npx tsx --env-file=./.env.local scripts/migrate-quick-pick-items.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

async function main() {
  console.log('Creating quick_pick_item table + index...')
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS quick_pick_item (
      id          text PRIMARY KEY,
      category    text NOT NULL,
      name        text NOT NULL,
      sort_order  integer NOT NULL DEFAULT 0,
      created_at  timestamp NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS quick_pick_category_idx
    ON quick_pick_item (category, sort_order)
  `)
  console.log('  ✔ table + index ready')
  console.log('\nDone. Seeder runs lazily from the app on first /meal-plan/quick-pick visit.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
