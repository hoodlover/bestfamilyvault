// One-off schema migration for the meal-plan changes that drizzle-kit
// push couldn't complete because the @neondatabase/serverless
// websocket hangs from local Windows shells. Uses the same Neon
// driver the app uses at runtime (which works fine).
//
// Idempotent — safe to run more than once. Each statement runs
// independently with its own try/catch so a partial state doesn't
// block the rest.
//
// Run:
//   npx tsx --env-file=.env.local scripts/apply-meal-plan-schema.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

interface Step {
  name: string
  // Idempotency check — when this returns true, skip the action.
  shouldSkip: () => Promise<boolean>
  action: () => Promise<unknown>
}

const STEPS: Step[] = [
  {
    name: 'meal_plan_recipe.scale → real',
    shouldSkip: async () => {
      const { rows } = await db.execute(sql`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = 'meal_plan_recipe' AND column_name = 'scale'
      `)
      const t = String(rows[0]?.data_type ?? '').toLowerCase()
      return t === 'real' || t === 'double precision' || t === 'numeric'
    },
    action: () => db.execute(sql`
      ALTER TABLE meal_plan_recipe
      ALTER COLUMN scale TYPE real USING scale::real
    `),
  },
  {
    name: 'meal_plan.skipped_item_keys (text[])',
    shouldSkip: async () => {
      const { rows } = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'meal_plan' AND column_name = 'skipped_item_keys'
      `)
      return rows.length > 0
    },
    action: () => db.execute(sql`
      ALTER TABLE meal_plan ADD COLUMN skipped_item_keys text[]
    `),
  },
  {
    name: 'shopping_list_item.item_key (text)',
    shouldSkip: async () => {
      const { rows } = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopping_list_item' AND column_name = 'item_key'
      `)
      return rows.length > 0
    },
    action: () => db.execute(sql`
      ALTER TABLE shopping_list_item ADD COLUMN item_key text
    `),
  },
  {
    // Replaces the `skipped_item_keys` exclude-list with an opt-in
    // include-list. The old column is left in place (see schema
    // comment) but is no longer read by app code.
    name: 'meal_plan.selected_item_keys (text[])',
    shouldSkip: async () => {
      const { rows } = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'meal_plan' AND column_name = 'selected_item_keys'
      `)
      return rows.length > 0
    },
    action: () => db.execute(sql`
      ALTER TABLE meal_plan ADD COLUMN selected_item_keys text[]
    `),
  },
]

async function main() {
  console.log('Applying meal-plan schema changes...\n')
  let applied = 0
  let skipped = 0
  let failed = 0
  for (const step of STEPS) {
    process.stdout.write(`  ${step.name} ... `)
    try {
      if (await step.shouldSkip()) {
        console.log('already in place, skipped.')
        skipped += 1
        continue
      }
      await step.action()
      console.log('applied.')
      applied += 1
    } catch (err) {
      failed += 1
      console.log('FAILED.')
      console.error('     ', err instanceof Error ? err.message : err)
    }
  }
  console.log('')
  console.log(`Done. ${applied} applied, ${skipped} already in place, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
