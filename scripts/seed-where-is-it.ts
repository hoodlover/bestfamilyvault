// One-shot: seed the "Where Is It" category and its starter areas.
//
// Idempotent — checks the category slug first; if it exists, skips the
// insert. Each subcategory insert uses ON CONFLICT DO NOTHING on the
// (category_id, slug) composite so re-runs add any missing areas without
// duplicating existing ones. Safe to run repeatedly.
//
// Run with: npx tsx --env-file=.env.local scripts/seed-where-is-it.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

// Starter areas — sortOrder dictates the chip-row order on /locate so
// the spaces the family actually uses most show up first.
const AREAS: Array<{ slug: string; name: string; sortOrder: number }> = [
  { slug: 'cabin',   name: 'Cabin',   sortOrder: 1 },
  { slug: 'home',    name: 'Home',    sortOrder: 2 },
  { slug: 'garage',  name: 'Garage',  sortOrder: 3 },
  { slug: 'office',  name: 'Office',  sortOrder: 4 },
  { slug: 'basement', name: 'Basement', sortOrder: 5 },
  { slug: 'storage', name: 'Storage', sortOrder: 6 },
  { slug: 'safe',    name: 'Safe',    sortOrder: 7 },
]

async function run() {
  const icon = '/icons/cobb/icons/system/locate.png'

  // Land Where Is It below Insurance (9) but above the LLCs so the
  // family-life cluster stays grouped.
  let categoryId: string
  const existing = (await sql`SELECT id FROM category WHERE slug = 'where-is-it'`) as Array<{ id: string }>
  if (existing.length > 0) {
    categoryId = existing[0].id
    console.log(`'Where Is It' category already exists (id=${categoryId}). Skipping insert; will reconcile subcategories.`)
  } else {
    const idRow = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
    categoryId = idRow[0].id
    await sql`
      INSERT INTO category (id, slug, name, icon, sort_order)
      VALUES (${categoryId}, 'where-is-it', 'Where Is It', ${icon}, 10)
    `
    console.log(`Created 'Where Is It' category (id=${categoryId}, sort_order=10).`)
  }

  // Subcategory inserts. The existing schema has a composite index on
  // (category_id, slug) but not a unique constraint, so we check before
  // inserting rather than relying on ON CONFLICT.
  let added = 0
  let skipped = 0
  for (const area of AREAS) {
    const present = (await sql`
      SELECT id FROM subcategory WHERE category_id = ${categoryId} AND slug = ${area.slug}
    `) as Array<{ id: string }>
    if (present.length > 0) {
      skipped++
      continue
    }
    const subIdRow = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
    await sql`
      INSERT INTO subcategory (id, category_id, slug, name, sort_order)
      VALUES (${subIdRow[0].id}, ${categoryId}, ${area.slug}, ${area.name}, ${area.sortOrder})
    `
    added++
  }
  console.log(`Subcategories: added=${added} skipped=${skipped} (of ${AREAS.length} expected).`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
