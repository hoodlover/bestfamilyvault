// One-shot diagnostic: dumps the user, category, and subcategory IDs
// I'll need to attribute the bulk family-docs import correctly.

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const users = await sql`SELECT id, name, email, role FROM "user" ORDER BY role, name`
  console.log('USERS:')
  for (const u of users) console.log(`  ${u.role.padEnd(10)} ${u.name?.padEnd(20)} ${u.email} ${u.id}`)

  const cats = await sql`SELECT id, slug, name FROM category ORDER BY sort_order`
  console.log('\nCATEGORIES:')
  for (const c of cats) console.log(`  ${c.slug.padEnd(28)} ${c.name?.padEnd(28)} ${c.id}`)

  const subs = await sql`
    SELECT s.id, c.slug AS cat_slug, s.name
    FROM subcategory s
    JOIN category c ON c.id = s.category_id
    ORDER BY c.sort_order, s.sort_order
  `
  console.log('\nSUBCATEGORIES:')
  for (const s of subs) console.log(`  [${s.cat_slug.padEnd(15)}] ${s.name.padEnd(28)} ${s.id}`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
