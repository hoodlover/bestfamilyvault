// One-shot: meal-plan + shopping-list schema. Adds:
//   • notes.servings (nullable integer) — for recipe yield
//   • meal_plan (one row per user)
//   • meal_plan_recipe (picks with scale)
//   • shopping_list_item (auto + manual, per-plan)
//
// Idempotent — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-meal-plan.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  // 1. notes.servings — recipe yield (e.g. "Serves 4"). Null for non-recipe
  // notes; we only render it when the note's category is the recipes one.
  await sql`ALTER TABLE note ADD COLUMN IF NOT EXISTS servings integer`

  // 2. meal_plan — one row per user (singleton). Lazy-inserted on first
  // visit to /meal-plan. unique index on user_id enforces the singleton.
  await sql`
    CREATE TABLE IF NOT EXISTS meal_plan (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS meal_plan_user_idx
      ON meal_plan(user_id)
  `

  // 3. meal_plan_recipe — picked recipes with scale. Unique on (plan, recipe)
  // so we can upsert by recipe id.
  await sql`
    CREATE TABLE IF NOT EXISTS meal_plan_recipe (
      id text PRIMARY KEY,
      meal_plan_id text NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
      recipe_id text NOT NULL REFERENCES note(id) ON DELETE CASCADE,
      scale integer NOT NULL DEFAULT 1,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS mpr_plan_recipe_idx
      ON meal_plan_recipe(meal_plan_id, recipe_id)
  `

  // 4. shopping_list_item — flat shopping list, mix of auto-generated
  // (from picked recipes) and manual rows. recipe_ids holds the contributors
  // for merged auto rows; is_manual is true for user-added items so the
  // recipe-driven regenerator can leave them alone.
  await sql`
    CREATE TABLE IF NOT EXISTS shopping_list_item (
      id text PRIMARY KEY,
      meal_plan_id text NOT NULL REFERENCES meal_plan(id) ON DELETE CASCADE,
      text text NOT NULL,
      recipe_ids text[] DEFAULT '{}',
      is_manual boolean NOT NULL DEFAULT false,
      purchased boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`
    CREATE INDEX IF NOT EXISTS shopping_list_plan_idx
      ON shopping_list_item(meal_plan_id)
  `

  console.log('Migration complete. Tables ready: meal_plan, meal_plan_recipe, shopping_list_item. note.servings column added.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
