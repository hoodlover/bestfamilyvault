// One-shot diagnostic: prints the IDNW letter content for each visible
// guide profile, both as stored (post-decrypt) and as it would render
// after cleanGuideContentForReading.
//
// Run with: npx tsx --env-file=.env.local scripts/dump-idnw-letter.ts

import { neon } from '@neondatabase/serverless'
import { decrypt } from '../src/lib/crypto'
import { cleanGuideContentForReading } from '../src/lib/guide-reading'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  const rows = (await sql`
    SELECT n.id, n.title, n.content, n.tags, c.slug AS category_slug
    FROM note n
    JOIN category c ON c.id = n.category_id
    WHERE 'now-what:letter' = ANY(n.tags)
    ORDER BY c.slug
  `) as Array<{ id: string; title: string; content: string; tags: string[]; category_slug: string }>

  if (rows.length === 0) {
    console.log('No IDNW letters found.')
    return
  }

  for (const row of rows) {
    console.log('═'.repeat(76))
    console.log(`${row.category_slug} — ${row.title}  (id ${row.id})`)
    console.log('─ RAW ─'.padEnd(76, '─'))
    const raw = decrypt(row.content) ?? row.content
    console.log(raw)
    console.log('─ AFTER cleanGuideContentForReading ─'.padEnd(76, '─'))
    console.log(cleanGuideContentForReading(raw))
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
