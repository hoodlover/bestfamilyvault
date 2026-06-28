// Add the three "standard LLC paperwork" subcategories — Startup Docs,
// Tax Filings, IRS — to every top-level LLC category that doesn't already
// have them. Each gets the same icon used on the CFS LLC equivalents so
// the LLC categories read consistently across the dashboard.
//
// Targets:
//   H & L Havens LLC (h-l-havens-llc)
//   Path to Change LLC (path-to-change-llc)
//   CFS LLC (cobb-family-solutions-llc) — already has these; skipped
//
// Idempotent — re-runs are no-ops on subs that already exist by slug.
// Run with: npx tsx --env-file=.env.local scripts/add-standard-llc-subs.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const TARGET_LLCS = ['h-l-havens-llc', 'path-to-change-llc', 'cobb-family-solutions-llc']

// LLC paperwork icons live at public/ root (Lance drops PNGs there
// directly so the URL is /<file>.png).
const STANDARD_SUBS: Array<{ name: string; slug: string; icon: string; sortOrder: number }> = [
  { name: 'Startup Docs', slug: 'startup-docs', icon: '/company_startup_doc.png', sortOrder: 90 },
  { name: 'Tax Filings', slug: 'tax-filings', icon: '/quarterlies.png', sortOrder: 91 },
  { name: 'IRS', slug: 'irs', icon: '/irspaperwork.png', sortOrder: 92 },
]

async function run() {
  for (const llcSlug of TARGET_LLCS) {
    const cat = (await sql`SELECT id, name FROM category WHERE slug = ${llcSlug}`) as Array<{ id: string; name: string }>
    if (cat.length === 0) {
      console.log(`! Category ${llcSlug} not found; skipping`)
      continue
    }
    const { id: catId, name: catName } = cat[0]
    console.log(`\n[${catName}]`)
    for (const sub of STANDARD_SUBS) {
      const existing = (await sql`
        SELECT id, icon FROM subcategory WHERE category_id = ${catId} AND slug = ${sub.slug}
      `) as Array<{ id: string; icon: string | null }>
      if (existing.length > 0) {
        // Already there — make sure the icon is pinned (don't trample if
        // user picked a different icon manually).
        if (!existing[0].icon) {
          await sql`UPDATE subcategory SET icon = ${sub.icon} WHERE id = ${existing[0].id}`
          console.log(`  ~ ${sub.name}: pinned icon`)
        } else {
          console.log(`  · ${sub.name}: already exists (icon already set)`)
        }
        continue
      }
      const idRow = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
      const newId = idRow[0].id
      await sql`
        INSERT INTO subcategory (id, category_id, name, slug, icon, sort_order)
        VALUES (${newId}, ${catId}, ${sub.name}, ${sub.slug}, ${sub.icon}, ${sub.sortOrder})
      `
      console.log(`  + ${sub.name}`)
    }
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
