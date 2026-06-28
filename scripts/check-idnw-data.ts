import { db } from '@/lib/db'
import { notes } from '@/lib/db/schema'
import { sql, like } from 'drizzle-orm'

async function main() {
  // Count notes with now-what:* tags
  const r = await db.execute(sql`
    SELECT count(*) AS n FROM note
    WHERE tags::text ILIKE '%now-what:%'
  `)
  console.log(`Notes with now-what:* tag: ${r.rows[0]?.n}`)

  // List the distinct tags
  const tags = await db.execute(sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM note
    WHERE tags::text ILIKE '%now-what:%'
    ORDER BY tag
  `)
  console.log(`\nDistinct now-what tags in DB:`)
  for (const row of tags.rows) {
    console.log(`  ${row.tag}`)
  }

  // Count notes per tag, also see content lengths
  const stats = await db.execute(sql`
    SELECT
      tag,
      count(*) AS n,
      sum(case when content IS NOT NULL AND length(content) > 50 then 1 else 0 end) AS with_content
    FROM (
      SELECT unnest(tags) AS tag, content FROM note WHERE tags::text ILIKE '%now-what:%'
    ) t
    WHERE tag LIKE 'now-what:%'
    GROUP BY tag
    ORDER BY tag
  `)
  console.log(`\nTopic tag → note count → notes with content >50 chars:`)
  for (const row of stats.rows) {
    console.log(`  ${(row.tag as string).padEnd(35)} ${row.n} notes / ${row.with_content} filled`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
