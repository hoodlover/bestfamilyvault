// One-shot: globally rename entry titles.
//   - 'PtC'      → 'PTC'    (LLC-name capitalization)
//   - 'Checking' → 'CHKG'   (compact bank-account names)
//
// Operates on entries.title only (plain text in the DB, NOT encrypted).
// Each UPDATE is idempotent: re-running finds zero rows once applied.
// Logs row counts before + after for each rename so the change is
// auditable in the terminal.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-rename-titles.ts

import { neon } from '@neondatabase/serverless'

interface RenameRule {
  from: string
  to: string
  description: string
}

const RULES: RenameRule[] = [
  { from: 'PtC', to: 'PTC', description: 'Capitalize PtC → PTC (LLC name)' },
  { from: 'Checking', to: 'CHKG', description: 'Shorten Checking → CHKG (bank account)' },
  { from: 'CHKG', to: 'Chkg', description: 'Lowercase CHKG → Chkg (less shouty)' },
]

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  for (const rule of RULES) {
    console.log(`\n→ ${rule.description}`)

    // Preview the matches before mutating so the run is auditable.
    const matches = (await sql`
      SELECT id, title
      FROM entry
      WHERE title LIKE ${'%' + rule.from + '%'}
      ORDER BY title
    `) as Array<{ id: string; title: string }>
    if (matches.length === 0) {
      console.log('  (no matching titles — nothing to do)')
      continue
    }
    console.log(`  ${matches.length} row${matches.length === 1 ? '' : 's'} to rename:`)
    for (const m of matches.slice(0, 12)) {
      const next = m.title.split(rule.from).join(rule.to)
      console.log(`    "${m.title}" → "${next}"`)
    }
    if (matches.length > 12) console.log(`    … and ${matches.length - 12} more`)

    // REPLACE is built-in Postgres — case-sensitive, all occurrences,
    // no regex needed. Runs in one statement so partial-failure is not
    // a concern (Neon serverless wraps each statement in its own tx).
    const updated = (await sql`
      UPDATE entry
      SET title = REPLACE(title, ${rule.from}, ${rule.to}),
          updated_at = now()
      WHERE title LIKE ${'%' + rule.from + '%'}
      RETURNING id
    `) as Array<{ id: string }>
    console.log(`  ✓ updated ${updated.length} row${updated.length === 1 ? '' : 's'}`)
  }

  console.log('\nDone.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
