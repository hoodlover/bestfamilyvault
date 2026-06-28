// Generate a human-editable markdown sheet listing every bank_account
// / credit_card entry that's missing fields only the owner can fill
// (account #, routing #, card #, expiry, etc.). Writes to
// FINANCE-FILLIN.md at the project root. Lance edits the placeholders,
// then runs apply-finance-fillin.ts to push the values back into the
// DB.

import { db } from '@/lib/db'
import { entries, subcategories } from '@/lib/db/schema'
import { eq, inArray, or } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT_PATH = path.resolve(process.cwd(), 'FINANCE-FILLIN.md')

// Fields per type that Lance might want to fill. We only list a field
// in the sheet when it's currently empty AND it's something only the
// owner knows. Public stuff (phone, url, accountType) was already
// auto-filled by enrich-finance-cards.ts so it's not here.
const OWNER_ONLY_FIELDS: Record<string, string[]> = {
  bank_account: ['accountNumber', 'routingNumber', 'cardholderName'],
  credit_card: ['cardholderName', 'cardNumber', 'cardNetwork', 'expiryDate'],
}

interface SheetItem {
  id: string
  title: string
  type: string
  llc: string | null
  missing: string[]
}

async function main() {
  const rows = await db
    .select()
    .from(entries)
    .where(or(eq(entries.type, 'bank_account'), eq(entries.type, 'credit_card')))

  const decrypted = decryptEntries(rows)
  const llcIds = Array.from(new Set(decrypted.map((e) => e.llcSubcategoryId).filter(Boolean) as string[]))
  const llcRows = llcIds.length
    ? await db.select({ id: subcategories.id, name: subcategories.name }).from(subcategories).where(inArray(subcategories.id, llcIds))
    : []
  const llcById = new Map(llcRows.map((r) => [r.id, r.name]))

  const items: SheetItem[] = []
  for (const e of decrypted) {
    const fields = OWNER_ONLY_FIELDS[e.type] ?? []
    const missing: string[] = []
    for (const f of fields) {
      const val = (e as unknown as Record<string, unknown>)[f]
      if (val == null || val === '') missing.push(f)
    }
    if (missing.length === 0) continue
    items.push({
      id: e.id,
      title: e.title,
      type: e.type,
      llc: e.llcSubcategoryId ? llcById.get(e.llcSubcategoryId) ?? null : null,
      missing,
    })
  }

  items.sort((a, b) => (a.type === b.type ? a.title.localeCompare(b.title) : a.type.localeCompare(b.type)))

  const lines: string[] = []
  lines.push('# Finance fill-in sheet')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString().slice(0, 10)}.`)
  lines.push('')
  lines.push('Fill in any value you know. Leave anything you don\'t want to set alone — empty')
  lines.push('placeholders are skipped on apply. Then run:')
  lines.push('')
  lines.push('    npx tsx --env-file=.env.local scripts/apply-finance-fillin.ts')
  lines.push('')
  lines.push('Apply is idempotent; you can edit, run, edit, run again. Existing populated')
  lines.push('fields in the DB are never overwritten by this script.')
  lines.push('')
  lines.push(`${items.length} entries still need owner-only data.`)
  lines.push('')

  for (const t of ['bank_account', 'credit_card']) {
    const list = items.filter((i) => i.type === t)
    if (list.length === 0) continue
    lines.push(`## ${t === 'bank_account' ? 'Bank accounts' : 'Credit / debit cards'}`)
    lines.push('')
    for (const item of list) {
      const llc = item.llc ? ` _[${item.llc}]_` : ''
      lines.push(`### ${item.title}${llc}`)
      lines.push('')
      lines.push(`<!-- id: ${item.id} -->`)
      for (const f of item.missing) {
        lines.push(`- **${f}**: `)
      }
      lines.push('')
    }
  }

  await writeFile(OUT_PATH, lines.join('\n'), 'utf8')
  console.log(`✅ wrote ${OUT_PATH}`)
  console.log(`   ${items.length} entries listed.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
