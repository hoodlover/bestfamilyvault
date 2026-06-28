// One-shot read-only audit of every bank_account / credit_card / debit
// entry in the vault. Reports which fields are filled and which are
// blank, so we know what enrichment work is actually needed before
// editing anything.

import { db } from '@/lib/db'
import { entries, subcategories } from '@/lib/db/schema'
import { eq, inArray, or } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'

interface Gap {
  id: string
  title: string
  type: string
  llc: string | null
  filled: string[]
  missing: string[]
}

async function main() {
  const rows = await db
    .select()
    .from(entries)
    .where(or(eq(entries.type, 'bank_account'), eq(entries.type, 'credit_card')))

  const decrypted = decryptEntries(rows)

  // Resolve LLC subcategory ids → names so we can group.
  const llcIds = Array.from(new Set(decrypted.map((e) => e.llcSubcategoryId).filter(Boolean) as string[]))
  const llcRows = llcIds.length
    ? await db.select({ id: subcategories.id, name: subcategories.name }).from(subcategories).where(inArray(subcategories.id, llcIds))
    : []
  const llcById = new Map(llcRows.map((r) => [r.id, r.name]))

  const gaps: Gap[] = decrypted.map((e) => {
    // Field manifest per type. "Filled" means non-null/non-empty.
    const want: Array<[string, unknown]> =
      e.type === 'bank_account'
        ? [
            ['bankName', e.bankName],
            ['accountType', e.accountType],
            ['accountNumber', e.accountNumber],
            ['routingNumber', e.routingNumber],
            ['phone', e.phone],
            ['url', e.url],
            ['cardholderName', e.cardholderName],
            ['currentBalance', e.currentBalance],
          ]
        : [
            ['cardholderName', e.cardholderName],
            ['cardNumber', e.cardNumber],
            ['cardNetwork', e.cardNetwork],
            ['expiryDate', e.expiryDate],
            ['phone', e.phone],
            ['url', e.url],
            ['currentBalance', e.currentBalance],
          ]

    const filled: string[] = []
    const missing: string[] = []
    for (const [k, v] of want) {
      if (v == null || v === '') missing.push(k)
      else filled.push(k)
    }

    return {
      id: e.id,
      title: e.title,
      type: e.type,
      llc: e.llcSubcategoryId ? llcById.get(e.llcSubcategoryId) ?? null : null,
      filled,
      missing,
    }
  })

  // Group by type for readability.
  for (const t of ['bank_account', 'credit_card']) {
    const list = gaps.filter((g) => g.type === t).sort((a, b) => a.title.localeCompare(b.title))
    console.log('\n' + '═'.repeat(80))
    console.log(`${t.toUpperCase()} (${list.length})`)
    console.log('═'.repeat(80))
    for (const g of list) {
      const llcTag = g.llc ? ` [${g.llc}]` : ''
      const ratio = `${g.filled.length}/${g.filled.length + g.missing.length}`
      console.log(`\n  ${g.title}${llcTag}  (${ratio} fields)`)
      console.log(`    ID: ${g.id}`)
      if (g.missing.length > 0) console.log(`    ⚠ MISSING: ${g.missing.join(', ')}`)
      if (g.filled.length > 0) console.log(`    ✓ filled : ${g.filled.join(', ')}`)
    }
  }

  // Top-line summary so we know where to focus.
  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY')
  console.log('═'.repeat(80))
  const ba = gaps.filter((g) => g.type === 'bank_account')
  const cc = gaps.filter((g) => g.type === 'credit_card')
  console.log(`  bank_account: ${ba.length} entries, ${ba.reduce((n, g) => n + g.missing.length, 0)} total missing fields`)
  console.log(`  credit_card:  ${cc.length} entries, ${cc.reduce((n, g) => n + g.missing.length, 0)} total missing fields`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
