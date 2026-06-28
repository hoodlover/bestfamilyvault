import { db } from '@/lib/db'
import { categories, notes } from '@/lib/db/schema'
import { sql, ilike } from 'drizzle-orm'

async function main() {
  const cats = await db.execute(sql`
    SELECT c.id, c.slug, c.name, count(n.id) AS note_count
    FROM category c LEFT JOIN note n ON n.category_id = c.id
    WHERE c.slug LIKE '%now-what%' OR c.slug LIKE '%dead%' OR c.name ILIKE '%dead%' OR c.name ILIKE '%now what%'
    GROUP BY c.id, c.slug, c.name
    ORDER BY note_count DESC
  `)
  console.log('Categories matching IDNW:')
  for (const r of cats.rows) {
    console.log(`  id=${(r.id as string).slice(0,8)} slug=${r.slug} name="${r.name}"  ${r.note_count} notes`)
  }

  // Total notes that contain "now-what" anywhere in tags
  const total = await db.execute(sql`SELECT count(*) AS n FROM note WHERE tags::text ILIKE '%now-what%'`)
  console.log(`\nTotal notes with now-what in tags: ${total.rows[0]?.n}`)

  // Sample 5 of them with all their tags + first 60 chars of content
  const sample = await db.execute(sql`
    SELECT n.title, n.tags, length(n.content) AS clen, c.name AS cat
    FROM note n LEFT JOIN category c ON n.category_id = c.id
    WHERE tags::text ILIKE '%now-what%' LIMIT 10
  `)
  console.log(`\nSample notes:`)
  for (const r of sample.rows) {
    console.log(`  cat=${r.cat} title="${r.title}" tags=${JSON.stringify(r.tags)} contentLen=${r.clen}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
