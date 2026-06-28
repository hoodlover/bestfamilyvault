import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const cats = await sql`
    SELECT slug, name, icon, sort_order
    FROM category
    ORDER BY sort_order, name
  `
  console.log('CATEGORIES:')
  for (const c of cats) {
    console.log(`  [${c.sort_order}] ${c.slug.padEnd(20)} ${(c.name as string).padEnd(20)} icon: ${c.icon ?? '(null)'}`)
  }

  const subs = await sql`
    SELECT subcategory.id, subcategory.name, subcategory.icon, category.slug AS cat_slug
    FROM subcategory
    JOIN category ON category.id = subcategory.category_id
    ORDER BY category.sort_order, subcategory.sort_order, subcategory.name
  `
  console.log('\nSUBCATEGORIES:')
  for (const s of subs) {
    console.log(`  [${(s.cat_slug as string).padEnd(15)}] ${(s.name as string).padEnd(28)} icon: ${s.icon ?? '(null)'}`)
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
