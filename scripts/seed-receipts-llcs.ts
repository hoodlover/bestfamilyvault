// One-shot: add a top-level Receipts category with 5 LLC subcategories, and
// create matching subfolders under the Vault File Drop so files dropped in
// `Vault File Drop\receipts\<llc-slug>\` route to the right subcategory on
// the next inbox sync. Idempotent — re-runs are no-ops.
//
// Run with: npx tsx --env-file=.env.local scripts/seed-receipts-llcs.ts

import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const INBOX_PATH = String.raw`C:\Users\lance\Documents\Vault File Drop`

const LLCS: Array<{ name: string; slug: string; icon: string }> = [
  { name: 'Path to Change, LLC', slug: 'path-to-change', icon: '/ptcllc.png' },
  { name: 'H&L Havens LLC', slug: 'hl-havens', icon: '/handlhavens.png' },
  { name: 'CFS, LLC', slug: 'cfs', icon: '/cfsllc.png' },
  { name: 'PTC Havens, LLC', slug: 'ptc-havens', icon: '/ptchavens.png' },
  { name: 'Place of Grace, LLC', slug: 'place-of-grace', icon: '/placeofgrace.png' },
]

async function run() {
  // 1. Top-level Receipts category. Land it at sort_order 10 so it sits
  //    near the other money/business stuff without disturbing the
  //    family-life categories above it. Pick a generic Finances icon
  //    until a dedicated receipts icon exists.
  const icon = '/icons/cobb/icons/Finances/receipts.png'
  const existing = (await sql`SELECT id FROM category WHERE slug = 'receipts'`) as Array<{ id: string }>
  let categoryId: string
  if (existing.length > 0) {
    categoryId = existing[0].id
    console.log(`Receipts category already exists (id=${categoryId}).`)
  } else {
    const id = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
    categoryId = id[0].id
    await sql`
      INSERT INTO category (id, slug, name, icon, sort_order, is_default)
      VALUES (${categoryId}, 'receipts', 'Receipts', ${icon}, 10, false)
    `
    console.log(`Created Receipts category (id=${categoryId}, sort_order=10).`)
  }

  // 2. LLC subcategories. Each one gets a stable slug under the Receipts
  //    parent so the inbox sweep can map folder name → subcategory.
  for (let i = 0; i < LLCS.length; i++) {
    const { name, slug, icon } = LLCS[i]
    const existingSub = (await sql`
      SELECT id FROM subcategory WHERE category_id = ${categoryId} AND slug = ${slug}
    `) as Array<{ id: string }>
    if (existingSub.length > 0) {
      console.log(`  Subcategory "${name}" already exists.`)
      continue
    }
    const subIdRow = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
    const subId = subIdRow[0].id
    await sql`
      INSERT INTO subcategory (id, category_id, name, slug, icon, sort_order)
      VALUES (${subId}, ${categoryId}, ${name}, ${slug}, ${icon}, ${i})
    `
    console.log(`  + Created subcategory "${name}" (slug=${slug}).`)
  }

  // 3. Create the matching folder structure under the Vault File Drop so
  //    Lance can start dropping files immediately. Only does anything on
  //    the Windows machine that has the drop folder; safe no-op elsewhere.
  if (process.platform === 'win32' && fs.existsSync(INBOX_PATH)) {
    const receiptsRoot = path.join(INBOX_PATH, 'receipts')
    fs.mkdirSync(receiptsRoot, { recursive: true })
    for (const { slug } of LLCS) {
      const llcDir = path.join(receiptsRoot, slug)
      if (!fs.existsSync(llcDir)) {
        fs.mkdirSync(llcDir, { recursive: true })
        console.log(`  + Created folder ${llcDir}`)
      }
    }
    console.log(`Folders ready under ${receiptsRoot}`)
  } else {
    console.log('Skipped folder creation — not on the Windows drop-folder host.')
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
