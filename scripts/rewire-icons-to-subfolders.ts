// Lance moved every root-level icon PNG (calendar.png, cfsllc.png, …)
// into its proper subfolder under public/icons/cobb/icons/. The DB
// rows that pointed at root paths need to follow. This script rewrites
// every category + subcategory row whose icon is a root path to the
// matching subfolder path, and reports anything it couldn't map.
//
// Idempotent — re-runs are no-ops once everything is migrated.
// Run with: npx tsx --env-file=.env.local scripts/rewire-icons-to-subfolders.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const MAPPING: Record<string, string> = {
  '/autofiles.png': '/icons/cobb/icons/auto/autofiles.png',
  '/cfsllc.png': '/icons/cobb/icons/llcs/cfsllc.png',
  '/handlhavens.png': '/icons/cobb/icons/llcs/handlhavens.png',
  '/ptcllc.png': '/icons/cobb/icons/llcs/ptcllc.png',
  '/ptchavens.png': '/icons/cobb/icons/llcs/ptchavens.png',
  '/placeofgrace.png': '/icons/cobb/icons/llcs/placeofgrace.png',
  '/company_startup_doc.png': '/icons/cobb/icons/llcs/company_startup_doc.png',
  '/irspaperwork.png': '/icons/cobb/icons/llcs/irspaperwork.png',
  '/quarterlies.png': '/icons/cobb/icons/llcs/quarterlies.png',
  '/calendar.png': '/icons/cobb/icons/system/calendar.png',
  '/vault_mystery_egg_512.png': '/icons/cobb/icons/system/vault_mystery_egg_512.png',
  '/guide.png': '/icons/cobb/icons/system/guide.png',
  '/upload_receipt_icon_512.png': '/icons/cobb/icons/system/upload_receipt_icon_512.png',
}

async function run() {
  let total = 0
  for (const [from, to] of Object.entries(MAPPING)) {
    const cats = (await sql`UPDATE category SET icon = ${to} WHERE icon = ${from} RETURNING id, name`) as Array<{ id: string; name: string }>
    const subs = (await sql`UPDATE subcategory SET icon = ${to} WHERE icon = ${from} RETURNING id, name`) as Array<{ id: string; name: string }>
    if (cats.length + subs.length > 0) {
      console.log(`${from} → ${to}  (cats=${cats.length} subs=${subs.length})`)
      total += cats.length + subs.length
    }
  }

  // Report anything still pointing at a root path so we know what's
  // left to map by hand.
  const stragglers = (await sql`
    SELECT 'cat' AS kind, id, name, icon FROM category WHERE icon LIKE '/%' AND icon NOT LIKE '/icons/%'
    UNION ALL
    SELECT 'sub' AS kind, id, name, icon FROM subcategory WHERE icon LIKE '/%' AND icon NOT LIKE '/icons/%'
  `) as Array<{ kind: string; id: string; name: string; icon: string }>

  console.log(`\nTotal rows rewired: ${total}`)
  if (stragglers.length > 0) {
    console.log(`\n! Still pointing at root paths — map by hand:`)
    for (const s of stragglers) console.log(`  [${s.kind}] ${s.name} → ${s.icon}`)
  } else {
    console.log('\n✓ No root-path stragglers.')
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
