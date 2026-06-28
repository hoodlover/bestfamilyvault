// One-time cleanup of duplicate/legacy recipe subcategories that
// survived earlier rename migrations or were seeded by the old
// default-category script. For each (old, new) pair:
//   1. Re-point any notes whose subcategoryId = old.id to new.id
//      (the schema's onDelete: 'set null' would orphan them otherwise).
//   2. Rewrite notes.tags arrays from old.name to new.name so the
//      /categories/recipes filter keeps finding them.
//   3. Delete the old subcategory row.
//
// Special case for crock-pot → slow-cooker: copy crock-pot's icon
// onto the slow-cooker row before deleting (slow-cooker has no icon
// in the current canonical list).
//
// Idempotent — re-running after success is a safe no-op.
//
// Run:
//   npx tsx --env-file=./.env.local scripts/migrate-remove-duplicate-subcats.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

const RENAMES = [
  { oldSlug: 'side-dishes', oldName: 'Side Dishes', newSlug: 'sides',       newName: 'Sides' },
  { oldSlug: 'soup',        oldName: 'Soup',        newSlug: 'soups',       newName: 'Soups' },
  { oldSlug: 'bread',       oldName: 'Bread',       newSlug: 'breads',      newName: 'Breads' },
  { oldSlug: 'vegetables',  oldName: 'Vegetables',  newSlug: 'veggies',     newName: 'Veggies' },
  { oldSlug: 'crock-pot',   oldName: 'Crock-Pot',   newSlug: 'slow-cooker', newName: 'Slow Cooker' },
]

async function main() {
  const cat = await db.execute(sql`SELECT id FROM category WHERE slug = 'recipes' LIMIT 1`)
  const recipesId = cat.rows[0]?.id as string | undefined
  if (!recipesId) {
    console.error('No "recipes" category found.')
    process.exit(0)
  }

  for (const r of RENAMES) {
    const oldRow = await db.execute(sql`
      SELECT id, icon FROM subcategory
      WHERE category_id = ${recipesId} AND slug = ${r.oldSlug}
      LIMIT 1
    `)
    if (oldRow.rows.length === 0) {
      console.log(`  · ${r.oldSlug} already gone, skipping`)
      continue
    }
    const oldId = oldRow.rows[0].id as string
    const oldIcon = oldRow.rows[0].icon as string | null

    const newRow = await db.execute(sql`
      SELECT id, icon FROM subcategory
      WHERE category_id = ${recipesId} AND slug = ${r.newSlug}
      LIMIT 1
    `)
    if (newRow.rows.length === 0) {
      console.warn(`  ! ${r.newSlug} doesn't exist — refusing to delete ${r.oldSlug} (would orphan its notes)`)
      continue
    }
    const newId = newRow.rows[0].id as string
    const newIcon = newRow.rows[0].icon as string | null

    // Re-point notes that were filed under the old subcategory.
    const repoint = await db.execute(sql`
      UPDATE note
      SET subcategory_id = ${newId}
      WHERE subcategory_id = ${oldId}
    `)
    if ((repoint.rowCount ?? 0) > 0) {
      console.log(`  ✔ repointed ${repoint.rowCount} notes from ${r.oldSlug} → ${r.newSlug}`)
    }

    // Rewrite tags arrays so any recipe tagged with the old name picks
    // up the new name and the filter still matches.
    const retag = await db.execute(sql`
      UPDATE note
      SET tags = array_replace(tags, ${r.oldName}, ${r.newName})
      WHERE tags @> ARRAY[${r.oldName}]::text[]
    `)
    if ((retag.rowCount ?? 0) > 0) {
      console.log(`  ✔ retagged ${retag.rowCount} notes "${r.oldName}" → "${r.newName}"`)
    }

    // Crock-Pot special case: carry its icon over to Slow Cooker if
    // Slow Cooker doesn't already have one.
    if (r.oldSlug === 'crock-pot' && oldIcon && !newIcon) {
      await db.execute(sql`
        UPDATE subcategory SET icon = ${oldIcon} WHERE id = ${newId}
      `)
      console.log(`  ✔ moved icon "${oldIcon}" from crock-pot → slow-cooker`)
    }

    // Finally delete the duplicate row.
    await db.execute(sql`DELETE FROM subcategory WHERE id = ${oldId}`)
    console.log(`  ✔ deleted ${r.oldSlug}`)
  }

  console.log('\nDone.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
