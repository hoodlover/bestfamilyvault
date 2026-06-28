// One-time migration to:
//   1) Add the parent_subcategory_id column + index to the subcategory
//      table. Both wrapped in `IF NOT EXISTS` so re-running is safe.
//   2) Seed Christmas / Easter / Thanksgiving as children of Holidays
//      under the Recipes category. Each gets its icon from
//      public/icons/recipe-icons.
//
// drizzle-kit push hangs on Windows + Neon websocket so this uses the
// app's own HTTP-driver db connection (works fine for migrations).
//
// Run:
//   npx tsx --env-file=./.env.local scripts/migrate-subcategory-nesting.ts

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

const HOLIDAY_CHILDREN = [
  { name: 'Christmas',    slug: 'christmas',    icon: '/icons/recipe-icons/christmas.png' },
  { name: 'Easter',       slug: 'easter',       icon: '/icons/recipe-icons/easter.png' },
  { name: 'Thanksgiving', slug: 'thanksgiving', icon: '/icons/recipe-icons/thanksgiving.png' },
]

async function main() {
  console.log('Adding parent_subcategory_id column + index...')
  await db.execute(sql`
    ALTER TABLE subcategory
    ADD COLUMN IF NOT EXISTS parent_subcategory_id text
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS subcategory_parent_idx
    ON subcategory (parent_subcategory_id)
  `)
  console.log('  ✔ column + index ready')

  // Find Recipes category.
  const cat = await db.execute(sql`SELECT id FROM category WHERE slug = 'recipes' LIMIT 1`)
  const recipesId = cat.rows[0]?.id as string | undefined
  if (!recipesId) {
    console.error('No "recipes" category found. Skipping holiday children.')
    process.exit(0)
  }

  // Find Holidays subcategory.
  const holidays = await db.execute(sql`
    SELECT id FROM subcategory
    WHERE category_id = ${recipesId} AND slug = 'holidays'
    LIMIT 1
  `)
  const holidaysId = holidays.rows[0]?.id as string | undefined
  if (!holidaysId) {
    console.error('No Holidays subcategory found. Run /recipes/new once to seed, then re-run.')
    process.exit(0)
  }
  console.log(`Holidays subcategory: ${holidaysId}`)

  // Seed each child. Skip if a row with the same (category_id, slug)
  // already exists.
  let inserted = 0
  for (let i = 0; i < HOLIDAY_CHILDREN.length; i++) {
    const c = HOLIDAY_CHILDREN[i]
    const existing = await db.execute(sql`
      SELECT id FROM subcategory
      WHERE category_id = ${recipesId} AND slug = ${c.slug}
      LIMIT 1
    `)
    if (existing.rows.length > 0) {
      // Already exists — make sure parent + icon are in sync.
      await db.execute(sql`
        UPDATE subcategory
        SET parent_subcategory_id = ${holidaysId}, icon = ${c.icon}
        WHERE id = ${existing.rows[0].id as string}
          AND (parent_subcategory_id IS DISTINCT FROM ${holidaysId}
               OR icon IS DISTINCT FROM ${c.icon})
      `)
      console.log(`  · ${c.slug} exists — synced parent + icon`)
      continue
    }
    // The id column is text whose default lives in drizzle's
    // $defaultFn, not Postgres — raw SQL inserts need an explicit
    // UUID. Generate one here so the row passes the NOT NULL check.
    const id = randomUUID()
    await db.execute(sql`
      INSERT INTO subcategory (id, category_id, parent_subcategory_id, name, slug, icon, sort_order)
      VALUES (${id}, ${recipesId}, ${holidaysId}, ${c.name}, ${c.slug}, ${c.icon}, ${(i + 1) * 10})
    `)
    console.log(`  ✔ inserted ${c.slug}`)
    inserted += 1
  }

  console.log('')
  console.log(`Done. ${inserted} children inserted.`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
