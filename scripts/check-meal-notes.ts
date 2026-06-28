import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { ilike, sql } from 'drizzle-orm'

async function main() {
  // Notes whose title mentions meal/grocery/menu
  const titleHits = await db.execute(sql`
    SELECT n.title, c.name AS category
    FROM note n LEFT JOIN category c ON n.category_id = c.id
    WHERE n.title ILIKE '%meal%' OR n.title ILIKE '%grocer%' OR n.title ILIKE '%menu%'
    LIMIT 10
  `)
  console.log('Notes mentioning meal/grocery/menu in title:')
  for (const r of titleHits.rows) console.log(`  [${r.category}] ${r.title}`)

  // Notes with meal-plan tag
  const tagged = await db.execute(sql`
    SELECT n.title FROM note n WHERE tags::text ILIKE '%meal%' LIMIT 10
  `)
  console.log('\nNotes tagged with meal:')
  for (const r of tagged.rows) console.log(`  ${r.title}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
