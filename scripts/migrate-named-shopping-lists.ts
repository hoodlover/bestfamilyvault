// Multi-list migration: introduces shopping_list rows + the
// shopping_list_id column on shopping_list_item, then backfills.
//
// For each existing meal_plan:
//   1. Insert a shopping_list (name="From Meal Plan", isAutoMealPlan=true)
//   2. Set shopping_list_item.shopping_list_id = that list's id for every
//      item whose meal_plan_id matches AND whose shopping_list_id is null
//
// Idempotent — re-running is a safe no-op (only creates auto-lists
// for meal plans that don't already have one).
//
// Run:
//   npx tsx --env-file=./.env.local scripts/migrate-named-shopping-lists.ts

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

async function main() {
  console.log('Creating shopping_list table + index...')
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS shopping_list (
      id                 text PRIMARY KEY,
      meal_plan_id       text NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
      name               text NOT NULL,
      is_auto_meal_plan  boolean NOT NULL DEFAULT false,
      sort_order         integer NOT NULL DEFAULT 0,
      created_at         timestamp NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS shopping_list_plan_idx
    ON shopping_list (meal_plan_id)
  `)
  console.log('  ✔ shopping_list ready')

  console.log('\nAdding shopping_list_id column to shopping_list_item...')
  await db.execute(sql`
    ALTER TABLE shopping_list_item
    ADD COLUMN IF NOT EXISTS shopping_list_id text
      REFERENCES shopping_list(id) ON DELETE CASCADE
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS shopping_list_item_list_idx
    ON shopping_list_item (shopping_list_id)
  `)
  console.log('  ✔ column + index ready')

  // Seed one auto-list per meal_plan that doesn't already have one.
  console.log('\nSeeding "From Meal Plan" auto-lists...')
  const plans = await db.execute(sql`SELECT id FROM meal_plan`)
  let seeded = 0
  let alreadyHave = 0
  for (const planRow of plans.rows) {
    const planId = planRow.id as string
    const existing = await db.execute(sql`
      SELECT id FROM shopping_list
      WHERE meal_plan_id = ${planId} AND is_auto_meal_plan = true
      LIMIT 1
    `)
    let listId: string
    if (existing.rows.length > 0) {
      listId = existing.rows[0].id as string
      alreadyHave += 1
    } else {
      listId = randomUUID()
      await db.execute(sql`
        INSERT INTO shopping_list (id, meal_plan_id, name, is_auto_meal_plan, sort_order)
        VALUES (${listId}, ${planId}, ${'From Meal Plan'}, true, 0)
      `)
      seeded += 1
    }

    // Backfill any items in this plan that don't yet point at a list.
    const updated = await db.execute(sql`
      UPDATE shopping_list_item
      SET shopping_list_id = ${listId}
      WHERE meal_plan_id = ${planId} AND shopping_list_id IS NULL
    `)
    if ((updated.rowCount ?? 0) > 0) {
      console.log(`  ✔ plan ${planId}: linked ${updated.rowCount} items to its auto-list`)
    }
  }
  console.log(`  ✔ ${seeded} new auto-lists seeded, ${alreadyHave} already existed`)

  console.log('\nDone. App code can now read/write via shopping_list_id.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
