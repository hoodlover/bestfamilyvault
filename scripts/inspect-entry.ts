// One-off diagnostic: prints the title, type, card_number, and
// account_number for every entry whose title matches a search term.
// Use when the importer says "no matching vault entry" but you're
// sure the entry exists — this confirms what's actually persisted.
//
// Run:
//   npx tsx --env-file=.env.local scripts/inspect-entry.ts <search>
//
// Examples:
//   npx tsx --env-file=.env.local scripts/inspect-entry.ts "Axos IRA"
//   npx tsx --env-file=.env.local scripts/inspect-entry.ts Bluevine
//   npx tsx --env-file=.env.local scripts/inspect-entry.ts 5671        # also scans account/card numbers
//
// Four-digit terms: card_number / account_number are encrypted at rest,
// so we can't ILIKE them in SQL. Instead we pull every bank_account +
// credit_card entry, decrypt, then filter in JS. Same approach the
// import-inbox matcher uses now that it knows those fields are
// encrypted.

import { ilike } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { decryptEntries } from '@/lib/crypto'

const term = process.argv[2]
if (!term) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/inspect-entry.ts <search>')
  process.exit(1)
}

;(async () => {
  const isFourDigit = /^\d{4}$/.test(term)

  let candidatesRaw
  if (isFourDigit) {
    // Pull every bank/credit entry plus any title match — same
    // candidate-set logic as the importer.
    candidatesRaw = await db
      .select({
        id: entries.id,
        title: entries.title,
        type: entries.type,
        bankName: entries.bankName,
        accountNumber: entries.accountNumber,
        cardNumber: entries.cardNumber,
        categoryId: entries.categoryId,
        currentBalance: entries.currentBalance,
        isPrivate: entries.isPrivate,
        isPersonal: entries.isPersonal,
      })
      .from(entries)
  } else {
    candidatesRaw = await db
      .select({
        id: entries.id,
        title: entries.title,
        type: entries.type,
        bankName: entries.bankName,
        accountNumber: entries.accountNumber,
        cardNumber: entries.cardNumber,
        categoryId: entries.categoryId,
        currentBalance: entries.currentBalance,
        isPrivate: entries.isPrivate,
        isPersonal: entries.isPersonal,
      })
      .from(entries)
      .where(ilike(entries.title, `%${term}%`))
  }

  const decrypted = decryptEntries(candidatesRaw)

  const rows = isFourDigit
    ? decrypted.filter((e) => {
        if (e.title.toLowerCase().includes(term)) return true
        if (e.accountNumber?.endsWith(term)) return true
        if (e.cardNumber?.endsWith(term)) return true
        return false
      })
    : decrypted

  if (rows.length === 0) {
    console.log(`No entries match "${term}".`)
    process.exit(0)
  }

  console.log(`Found ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} matching "${term}":\n`)
  for (const e of rows) {
    console.log(`  ${e.title}  (${e.type})`)
    console.log(`    id: ${e.id}`)
    if (e.bankName) console.log(`    bank_name:      ${e.bankName}`)
    console.log(`    account_number: ${e.accountNumber === null ? '(null)' : `"${e.accountNumber}"`}`)
    console.log(`    card_number:    ${e.cardNumber === null ? '(null)' : `"${e.cardNumber}"`}`)
    if (e.currentBalance != null) {
      console.log(`    balance:        $${(e.currentBalance / 100).toFixed(2)}`)
    }
    if (e.isPrivate) console.log(`    isPrivate: true`)
    if (e.isPersonal) console.log(`    isPersonal: true`)
    console.log()
  }

  if (isFourDigit) {
    console.log(`Tip: the importer scans account_number / card_number with ENDS-WITH "${term}".`)
    console.log(`     Both fields are encrypted at rest — values above are decrypted for display.`)
  }
})()
