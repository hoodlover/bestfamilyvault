// Rewire every DB icon path that was set to /icons/cobb/icons/llcs/<file>
// down to /<file> — matching where Lance actually dropped the PNGs
// (public/ root). Also fixes ptrchavens.png → ptchavens.png.
//
// Run with: npx tsx --env-file=.env.local scripts/rewire-icons-to-public-root.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const renameMap: Record<string, string> = {
  ptrchavens: 'ptchavens',
}

const wanted = [
  'autofiles',
  'cfsllc',
  'company_startup_doc',
  'handlhavens',
  'irspaperwork',
  'placeofgrace',
  'ptchavens',
  'ptcllc',
  'quarterlies',
]

async function run() {
  // Rewire categories
  const cats = (await sql`
    SELECT id, name, icon FROM category
    WHERE icon LIKE '/icons/cobb/icons/llcs/%'
  `) as Array<{ id: string; name: string; icon: string }>
  for (const c of cats) {
    const file = c.icon.replace(/^.*\//, '').replace(/\.png$/, '')
    const fixed = renameMap[file] ?? file
    const next = `/${fixed}.png`
    await sql`UPDATE category SET icon = ${next} WHERE id = ${c.id}`
    console.log(`cat  [${c.name}] ${c.icon} → ${next}`)
  }

  // Rewire subcategories
  const subs = (await sql`
    SELECT s.id, s.name, s.icon, c.name AS cat FROM subcategory s
    JOIN category c ON c.id = s.category_id
    WHERE s.icon LIKE '/icons/cobb/icons/llcs/%'
  `) as Array<{ id: string; name: string; icon: string; cat: string }>
  for (const s of subs) {
    const file = s.icon.replace(/^.*\//, '').replace(/\.png$/, '')
    const fixed = renameMap[file] ?? file
    const next = `/${fixed}.png`
    await sql`UPDATE subcategory SET icon = ${next} WHERE id = ${s.id}`
    console.log(`sub  [${s.cat} → ${s.name}] ${s.icon} → ${next}`)
  }

  // Sanity check — list any remaining /icons/cobb/icons/llcs/ references
  const stragglers = (await sql`
    SELECT 'cat' AS kind, name, icon FROM category WHERE icon LIKE '/icons/cobb/icons/llcs/%'
    UNION ALL
    SELECT 'sub' AS kind, name, icon FROM subcategory WHERE icon LIKE '/icons/cobb/icons/llcs/%'
  `) as Array<{ kind: string; name: string; icon: string }>
  if (stragglers.length === 0) {
    console.log('\n✓ No remaining /icons/cobb/icons/llcs/ references.')
  } else {
    console.log('\n! Remaining:', stragglers)
  }

  // Sanity check — print final paths for the 9 wanted files
  console.log('\nFinal LLC icon wiring:')
  for (const w of wanted) {
    const rows = (await sql`
      SELECT 'cat' AS kind, name FROM category WHERE icon = ${`/${w}.png`}
      UNION ALL
      SELECT 'sub' AS kind, name FROM subcategory WHERE icon = ${`/${w}.png`}
    `) as Array<{ kind: string; name: string }>
    console.log(`  /${w}.png → ${rows.map((r) => `${r.kind}:${r.name}`).join(', ') || '(unused)'}`)
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
