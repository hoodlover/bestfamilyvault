// One-shot: rename the seeded "Shed" subcategory under the
// `where-is-it` category to "Basement". The subcategory id stays the
// same, so any notes / items already filed under it remain linked
// correctly — only the user-visible name + the slug change.
//
// Idempotent: re-running is a no-op if the row is already renamed.
// Also a no-op if a separate "Basement" already exists (in which case
// the script logs which one to clean up by hand).
//
// Run with: npx tsx --env-file=.env.local scripts/rename-shed-to-basement.ts

import { neon } from '@neondatabase/serverless'

async function run() {
  const sql = neon(process.env.DATABASE_URL!)

  const cat = (await sql`SELECT id FROM category WHERE slug = 'where-is-it'`) as Array<{ id: string }>
  if (cat.length === 0) {
    console.log('No `where-is-it` category found — nothing to rename. (Run seed-where-is-it.ts first if needed.)')
    return
  }
  const categoryId = cat[0].id

  const subs = (await sql`
    SELECT id, slug, name FROM subcategory
    WHERE category_id = ${categoryId} AND slug IN ('shed', 'basement')
  `) as Array<{ id: string; slug: string; name: string }>

  const shed = subs.find((s) => s.slug === 'shed')
  const basement = subs.find((s) => s.slug === 'basement')

  if (basement && shed) {
    console.log(`Both 'shed' (${shed.id}) and 'basement' (${basement.id}) exist. Leaving them as-is — merge or delete one manually if you want a single area.`)
    return
  }

  if (basement) {
    console.log(`'basement' already exists (${basement.id}). Nothing to do.`)
    return
  }

  if (!shed) {
    console.log("No 'shed' row found — already renamed or never seeded. Nothing to do.")
    return
  }

  await sql`
    UPDATE subcategory
    SET slug = 'basement', name = 'Basement'
    WHERE id = ${shed.id}
  `
  console.log(`✓ Renamed 'Shed' (${shed.id}) → 'Basement'. Existing items keep their subcategory_id, so links are intact.`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
