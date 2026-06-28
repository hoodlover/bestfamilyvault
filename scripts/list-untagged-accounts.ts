// One-shot diagnostic: list every bank_account / credit_card entry and
// whether each one has an LLC tag set. Helps Lance see at a glance which
// entries still need tagging.
//
// Run: npx tsx --env-file=.env.local scripts/list-untagged-accounts.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

;(async () => {
  // Pull the LLC list first so we can show names, not ids.
  const llcRows = await sql.query(`
    SELECT s.id, s.name
    FROM subcategory s
    JOIN category c ON c.id = s.category_id
    WHERE c.slug = 'receipts'
    ORDER BY s.sort_order, s.name
  `) as { id: string; name: string }[]
  const llcById = new Map(llcRows.map((r) => [r.id, r.name]))

  console.log('Available LLC tags:')
  for (const llc of llcRows) console.log(`  - ${llc.name}`)
  console.log('')

  // All bank + credit-card entries, regardless of who owns them.
  const entries = await sql.query(`
    SELECT e.id, e.title, e.type, e.bank_name, e.llc_subcategory_id, u.email
    FROM entry e
    LEFT JOIN "user" u ON u.id = e.created_by
    WHERE e.type IN ('bank_account', 'credit_card')
    ORDER BY u.email, e.type, e.title
  `) as Array<{
    id: string
    title: string
    type: string
    bank_name: string | null
    llc_subcategory_id: string | null
    email: string | null
  }>

  if (entries.length === 0) {
    console.log('No bank_account or credit_card entries found.')
    return
  }

  let untagged = 0
  let tagged = 0

  for (const e of entries) {
    const llcName = e.llc_subcategory_id ? llcById.get(e.llc_subcategory_id) ?? '(unknown LLC id)' : null
    const tag = llcName ? `✓ ${llcName}` : '· (untagged)'
    const bank = e.bank_name ? ` [${e.bank_name}]` : ''
    console.log(`  ${tag.padEnd(32)} ${e.type.padEnd(13)} ${e.title}${bank}`)
    console.log(`     → /entries/${e.id}/edit  (owner: ${e.email ?? '?'})`)
    if (llcName) tagged++
    else untagged++
  }

  console.log('')
  console.log(`Summary: ${tagged} tagged · ${untagged} untagged · ${entries.length} total.`)
})()
