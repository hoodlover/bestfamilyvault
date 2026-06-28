// Diagnostic: dump the full non-encrypted record for the two suspiciously
// long-title entries Lance flagged on the Break Glass… page. Looks them
// up by partial-title match (LIKE), then prints id / createdAt / updatedAt /
// createdBy / type / isRecurring / url / tags so we can see when + how
// they were created and what their associated URL is.
//
// Encrypted fields (password, accountNumber, etc.) are deliberately
// excluded — this is for "who entered this and when?", not credential
// dump.
//
// Run with: npx tsx --env-file=.env.local scripts/lookup-long-titles.ts

import { neon } from '@neondatabase/serverless'

interface Match {
  id: string
  type: string
  title: string
  url: string | null
  is_recurring: boolean
  tags: string[] | null
  created_by: string
  creator_name: string | null
  creator_email: string | null
  created_at: Date
  updated_at: Date
  category_name: string | null
}

const NEEDLES = [
  'Upromise',
  'Paitons Info',
]

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  for (const needle of NEEDLES) {
    console.log(`\n──── matches for title LIKE '%${needle}%' ────`)
    const rows = (await sql`
      SELECT e.id, e.type, e.title, e.url, e.is_recurring, e.tags,
             e.created_by,
             u.name  AS creator_name,
             u.email AS creator_email,
             e.created_at, e.updated_at,
             c.name  AS category_name
      FROM entry e
      LEFT JOIN "user"   u ON u.id = e.created_by
      LEFT JOIN category c ON c.id = e.category_id
      WHERE e.title ILIKE ${'%' + needle + '%'}
      ORDER BY e.created_at
    `) as Match[]

    if (rows.length === 0) {
      console.log('  (no matches)')
      continue
    }
    for (const r of rows) {
      const ageMs = Date.now() - new Date(r.created_at).getTime()
      const ageDays = Math.round(ageMs / (1000 * 60 * 60 * 24))
      console.log(`
  id          ${r.id}
  type        ${r.type}${r.is_recurring ? '  (recurring)' : ''}
  category    ${r.category_name ?? '(uncategorized)'}
  title       ${r.title}
  url         ${r.url ?? '—'}
  tags        ${(r.tags ?? []).join(', ') || '—'}
  created by  ${r.creator_name ?? r.creator_email ?? r.created_by}
  created     ${new Date(r.created_at).toISOString().slice(0, 16)}  (${ageDays}d ago)
  updated     ${new Date(r.updated_at).toISOString().slice(0, 16)}
  vault link  /entries/${r.id}/edit`)
    }
  }

  console.log('\nDone.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
