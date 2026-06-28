// One-shot: for recurring entries whose title starts with "domain:",
// lowercase the full title.
//
// Match shape: titles like "domain: BlahBlah" / "Domain: BlahBlah" /
// "DOMAIN: foo" all qualify (case-insensitive prefix match). The full
// title is then lowercased — "domain: BlahBlah" → "domain: blahblah",
// "Domain: BlahBlah" → "domain: blahblah".
//
// Scope: entry.is_recurring = true only. Non-recurring entries with the
// same shape stay untouched (they may have intentional casing).
//
// Run with:
//   npx tsx --env-file=.env.local scripts/migrate-lowercase-recurring-domain-titles.ts

import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  // Preview before mutating so the run is auditable.
  const matches = (await sql`
    SELECT id, title
    FROM entry
    WHERE is_recurring = true
      AND title ILIKE 'domain:%'
    ORDER BY title
  `) as Array<{ id: string; title: string }>

  if (matches.length === 0) {
    console.log('No recurring "domain:…" titles found — nothing to do.')
    return
  }

  console.log(`${matches.length} recurring "domain:…" title${matches.length === 1 ? '' : 's'} to lowercase:`)
  for (const m of matches.slice(0, 20)) {
    if (m.title === m.title.toLowerCase()) {
      console.log(`    "${m.title}"  (already all lowercase — no change)`)
    } else {
      console.log(`    "${m.title}" → "${m.title.toLowerCase()}"`)
    }
  }
  if (matches.length > 20) console.log(`    … and ${matches.length - 20} more`)

  // LOWER() runs server-side; only rows that actually change are touched
  // (the WHERE filters by case-insensitive prefix AND requires the
  // current title to differ from its lowercase form, so re-runs are
  // idempotent and don't bump updated_at on already-clean rows).
  const updated = (await sql`
    UPDATE entry
    SET title = LOWER(title),
        updated_at = now()
    WHERE is_recurring = true
      AND title ILIKE 'domain:%'
      AND title <> LOWER(title)
    RETURNING id
  `) as Array<{ id: string }>
  console.log(`\n✓ updated ${updated.length} row${updated.length === 1 ? '' : 's'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
