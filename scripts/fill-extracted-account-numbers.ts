// Set the account number on each bank_account entry from values
// extracted directly from imported statement PDFs. Idempotent — never
// overwrites an existing accountNumber. Dry-run by default.
//
// Each entry below has its source PDF noted in the comment so future-
// you can trace where a number came from. Account numbers are encrypted
// at rest, same as everywhere else.

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decryptEntries, encrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

interface AccountUpdate {
  entryId: string
  title: string
  accountNumber: string
  source: string
}

const UPDATES: AccountUpdate[] = [
  {
    entryId: '1f743115-a46f-4675-bd2c-f96f40c67d4d',
    title: 'Axos Bank 0254',
    accountNumber: '100002740254',
    source: 'Imported/2026/2026-02-01 - Axos Bank Rewards Checking.pdf, page 1',
  },
  {
    entryId: '56eb5e38-27af-4536-8257-b7ca23a197e8',
    title: 'Axos Bank 0262',
    accountNumber: '100002740262',
    source: 'Imported/2026/2026-02-01 - Axos Bank High Yield Savings.pdf, page 1',
  },
  {
    entryId: 'e0b6740d-cf9d-42a7-83ef-b8b056c7be7d',
    title: 'BofA Checking 0202',
    accountNumber: '3340 5963 0202',
    source: 'Imported/2026/2026-01-28 - Bank of America Adv Plus Banking Preferred Rewards Platinum Honors.pdf, page 1',
  },
  {
    entryId: 'a09ac292-7c35-485f-afb3-86f3a807b938',
    title: 'BofA Savings 0695',
    accountNumber: '3340 5975 0695',
    source: 'Imported/2026/2026-01-27 - Bank of America Advantage Savings Preferred Rewards Platinum Honors.pdf, page 1',
  },
  {
    entryId: '1ca7a87b-f23f-4ce4-b64c-0cc4b16af76f',
    title: 'Bluevine Checking 8845 — H&L Havens LLC',
    accountNumber: '875108578845',
    source: 'Imported/2026/2026-01-31 - Bluevine Bluevine Business Checking.pdf, page 1',
  },
  {
    entryId: '709ad77c-9e77-4aef-b526-5c217ac743e4',
    title: 'Bluevine Checking 9058 — Place of Grace LLC',
    accountNumber: '875108579058',
    source: 'Imported/2026/2026-01-31 - Bluevine Business Checking Account.pdf, page 1 (statement holder name on file at Bluevine is H&L HAVENS LLC, last-4 matches vault title)',
  },
  {
    entryId: '54307256-b0bc-4902-8e5c-07a5afb5fc31',
    title: 'Bluevine Checking 6628 — H&L Havens LLC',
    accountNumber: '875109206628',
    source: 'Imported/2026/2026-01-31 - Bluevine Business Checking.pdf, page 1',
  },
  {
    entryId: 'c9e67929-a844-4fb2-bfb9-fb9f15fa4124',
    title: 'Bluevine Checking 6242 — PTC Havens LLC',
    accountNumber: '875108686242',
    source: 'Imported/2026/2026-01-31 - Bluevine Bluevine Business Checking (SweepSavings).pdf, page 1',
  },
  // Bluevine Checking 6259 — Personal — Home Improvements
  // entryId: 811b4be7-e0f3-4154-99d9-456855aec3c3
  // No statement available in the imported PDFs for this account
  // (likely new / zero-activity). Lance needs to provide the full
  // account number from online banking — add to FINANCE-FILLIN.md
  // and re-run apply-finance-fillin.ts.
]

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  let updated = 0
  let skipped = 0
  for (const u of UPDATES) {
    const row = await db.select().from(entries).where(eq(entries.id, u.entryId)).then((r) => r[0])
    if (!row) {
      console.log(`  ⚠ ${u.title}  — entry ${u.entryId} not found, skipping`)
      continue
    }
    const dec = decryptEntries([row])[0]
    if (dec.accountNumber && dec.accountNumber.trim() !== '') {
      console.log(`  · ${u.title}  — already has accountNumber (${dec.accountNumber}) — skipping`)
      skipped++
      continue
    }
    console.log(`${APPLY ? 'UPDATE' : 'would update'}: ${u.title}`)
    console.log(`    accountNumber → ${u.accountNumber}`)
    console.log(`    source: ${u.source}`)
    if (APPLY) {
      await db
        .update(entries)
        .set({ accountNumber: encrypt(u.accountNumber) ?? '' })
        .where(eq(entries.id, u.entryId))
    }
    updated++
  }
  console.log(
    `\n${updated} entries ${APPLY ? 'updated' : 'would be updated'}, ${skipped} already had a number.`,
  )
  if (!APPLY && updated > 0) console.log('Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
