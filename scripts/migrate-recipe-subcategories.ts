// One-time migration to:
//   1) Rename four recipe subcategories to shorter/plural forms:
//      Side Dishes → Sides, Soup → Soups, Bread → Breads,
//      Vegetables → Veggies. (Both name AND slug change.)
//   2) Set the icon column on every recipe subcategory row to the new
//      artwork in public/icons/recipe-icons/. New installs get this
//      via the updated seeder; this script catches all the rows that
//      were inserted before the seeder learned to write icons.
//   3) Rewrite notes.tags arrays so any recipe tagged with an old
//      name (e.g. "Side Dishes") gets the new name (e.g. "Sides").
//      Without this the filter on /categories/recipes?sub=<sides>
//      wouldn't match those notes.
//
// Idempotent — re-running is safe.
//
// Run:
//   npx tsx --env-file=.env.local scripts/migrate-recipe-subcategories.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db/index'

interface IconRow {
  slug: string
  icon: string | null
}

// Must match RECIPE_SUBCATEGORIES in src/lib/actions/recipes.ts.
const ICONS: IconRow[] = [
  { slug: 'slow-cooker', icon: null },
  { slug: 'poultry',     icon: '/icons/recipe-icons/chicken.png' },
  { slug: 'seafood',     icon: '/icons/recipe-icons/seafood.png' },
  { slug: 'desserts',    icon: '/icons/recipe-icons/desserts.png' },
  { slug: 'salads',      icon: '/icons/recipe-icons/salads.png' },
  { slug: 'sides',       icon: '/icons/recipe-icons/sides.png' },
  { slug: 'soups',       icon: '/icons/recipe-icons/soups.png' },
  { slug: 'breads',      icon: '/icons/recipe-icons/breads.png' },
  { slug: 'appetizers',  icon: '/icons/recipe-icons/appetizers.png' },
  { slug: 'vegetarian',  icon: '/icons/recipe-icons/vegetarian.png' },
  { slug: 'pasta',       icon: '/icons/recipe-icons/pasta.png' },
  { slug: 'meat',        icon: null },
  { slug: 'veggies',     icon: '/icons/recipe-icons/veggies.png' },
  { slug: 'cookies',     icon: '/icons/recipe-icons/cookies.png' },
  { slug: 'holidays',    icon: '/icons/recipe-icons/holidays.png' },
]

// (oldSlug, oldName) → (newSlug, newName). Applied only to rows under
// the 'recipes' category so we don't collide with same-named subs on
// other categories.
const RENAMES = [
  { oldSlug: 'side-dishes', oldName: 'Side Dishes', newSlug: 'sides',   newName: 'Sides' },
  { oldSlug: 'soup',        oldName: 'Soup',        newSlug: 'soups',   newName: 'Soups' },
  { oldSlug: 'bread',       oldName: 'Bread',       newSlug: 'breads',  newName: 'Breads' },
  { oldSlug: 'vegetables',  oldName: 'Vegetables',  newSlug: 'veggies', newName: 'Veggies' },
]

async function main() {
  const cat = await db.execute(sql`SELECT id FROM category WHERE slug = 'recipes' LIMIT 1`)
  const recipesId = cat.rows[0]?.id as string | undefined
  if (!recipesId) {
    console.error('No "recipes" category found. Nothing to migrate.')
    process.exit(0)
  }
  console.log(`Recipes category: ${recipesId}`)

  // 1) Renames. Skip if the new slug already exists (re-run safety).
  let renamed = 0
  for (const r of RENAMES) {
    const collision = await db.execute(sql`
      SELECT 1 FROM subcategory
      WHERE category_id = ${recipesId} AND slug = ${r.newSlug}
      LIMIT 1
    `)
    if (collision.rows.length > 0) {
      // New slug already exists. If the old one also exists, delete it
      // (orphaned from a prior partial run). Otherwise no-op.
      const old = await db.execute(sql`
        SELECT id FROM subcategory
        WHERE category_id = ${recipesId} AND slug = ${r.oldSlug}
        LIMIT 1
      `)
      if (old.rows.length > 0) {
        await db.execute(sql`
          DELETE FROM subcategory
          WHERE category_id = ${recipesId} AND slug = ${r.oldSlug}
        `)
        console.log(`  · deleted orphaned ${r.oldSlug} (new ${r.newSlug} already exists)`)
      } else {
        console.log(`  · ${r.oldSlug} → ${r.newSlug} already migrated, skipping`)
      }
      continue
    }
    const res = await db.execute(sql`
      UPDATE subcategory
      SET slug = ${r.newSlug}, name = ${r.newName}
      WHERE category_id = ${recipesId} AND slug = ${r.oldSlug}
    `)
    if ((res.rowCount ?? 0) > 0) {
      renamed += 1
      console.log(`  ✔ renamed ${r.oldSlug}/${r.oldName} → ${r.newSlug}/${r.newName}`)
    }
  }

  // 2) Icon backfill on every recipe subcat.
  let iconed = 0
  for (const row of ICONS) {
    if (row.icon === null) continue
    const res = await db.execute(sql`
      UPDATE subcategory
      SET icon = ${row.icon}
      WHERE category_id = ${recipesId} AND slug = ${row.slug}
        AND (icon IS DISTINCT FROM ${row.icon})
    `)
    if ((res.rowCount ?? 0) > 0) {
      iconed += 1
      console.log(`  ✔ icon set for ${row.slug}`)
    }
  }

  // 3) Rewrite notes.tags so recipes tagged with the old NAME pick up
  //    the new NAME. Postgres array_replace is element-level.
  let tagUpdates = 0
  for (const r of RENAMES) {
    const res = await db.execute(sql`
      UPDATE note
      SET tags = array_replace(tags, ${r.oldName}, ${r.newName})
      WHERE tags @> ARRAY[${r.oldName}]::text[]
    `)
    if ((res.rowCount ?? 0) > 0) {
      tagUpdates += res.rowCount ?? 0
      console.log(`  ✔ retagged ${res.rowCount} notes from "${r.oldName}" → "${r.newName}"`)
    }
  }

  console.log('')
  console.log(`Done. ${renamed} renamed, ${iconed} icons set, ${tagUpdates} note tags rewritten.`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e)
  process.exit(1)
})
