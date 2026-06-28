// One-shot: add a top-level Insurance category. Idempotent — uses
// ON CONFLICT DO NOTHING on the slug so re-runs are no-ops. Picks a
// sort_order that lands between legal and the LLCs (so the family-life
// stuff stays clustered above the LLCs).
//
// Run with: npx tsx --env-file=.env.local scripts/seed-insurance-category.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  // Pick an icon from the new Insurance/ folder so the picker shows
  // something meaningful out of the gate.
  const icon = '/icons/cobb/icons/Insurance/home_insurance-001.png'

  // Land Insurance just below Legal (sort_order 18) but above the LLCs.
  // If a row with this slug already exists, do nothing.
  const existing = (await sql`SELECT id FROM category WHERE slug = 'insurance'`) as Array<{ id: string }>
  if (existing.length > 0) {
    console.log('Insurance category already exists. Nothing to do.')
    return
  }

  const id = (await sql`SELECT gen_random_uuid()::text AS id`) as Array<{ id: string }>
  const newId = id[0].id
  await sql`
    INSERT INTO category (id, slug, name, icon, sort_order)
    VALUES (${newId}, 'insurance', 'Insurance', ${icon}, 9)
  `
  console.log(`Created Insurance category (id=${newId}, sort_order=9, icon=${icon}).`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
