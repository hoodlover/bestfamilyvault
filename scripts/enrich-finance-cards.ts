// Auto-fill the SAFE public fields (phone, url, accountType) on every
// bank_account / credit_card entry where they're empty. Skips anything
// already populated. Never touches sensitive fields — account numbers,
// routing numbers, full card numbers, CVV, expiry stay untouched.
//
// Dry-run by default. Pass --apply to actually write.
//
//   npx tsx --env-file=.env.local scripts/enrich-finance-cards.ts
//   npx tsx --env-file=.env.local scripts/enrich-finance-cards.ts --apply

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq, or } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

// ─── Publicly-known issuer / bank contact info ─────────────────────────────
//
// Each entry below lists the data we trust as "look this up on the back
// of any card / on their public site." Phones are general customer-
// service lines (not lost/stolen — those are different and not what a
// surviving family member needs first).

interface IssuerInfo {
  phone: string
  url: string
}

const BANK_INFO: Record<string, IssuerInfo> = {
  axos: { phone: '(888) 502-2967', url: 'https://www.axosbank.com/' },
  bluevine: { phone: '(888) 216-9619', url: 'https://www.bluevine.com/' },
  bofa: { phone: '(800) 432-1000', url: 'https://www.bankofamerica.com/' },
  'bank of america': { phone: '(800) 432-1000', url: 'https://www.bankofamerica.com/' },
}

const CARD_ISSUER_INFO: Record<string, IssuerInfo> = {
  amex: { phone: '(800) 528-4800', url: 'https://www.americanexpress.com/' },
  'american express': { phone: '(800) 528-4800', url: 'https://www.americanexpress.com/' },
  bofa: { phone: '(800) 732-9194', url: 'https://www.bankofamerica.com/credit-cards/' },
  'bank of america': { phone: '(800) 732-9194', url: 'https://www.bankofamerica.com/credit-cards/' },
  'back of america': { phone: '(800) 732-9194', url: 'https://www.bankofamerica.com/credit-cards/' },
  bluevine: { phone: '(888) 216-9619', url: 'https://www.bluevine.com/' },
  ptc: { phone: '(888) 216-9619', url: 'https://www.bluevine.com/' }, // PtC debit cards = Bluevine
}

// Resolve a bank entry to its issuer info based on the bankName field
// (preferred) or the title (fallback). Lowercase substring match keeps
// the table small while handling variants ("BofA Savings", "Bank of
// America Checking").
function lookupBankInfo(bankName: string | null, title: string): IssuerInfo | null {
  const hay = `${bankName ?? ''} ${title}`.toLowerCase()
  for (const [needle, info] of Object.entries(BANK_INFO)) {
    if (hay.includes(needle)) return info
  }
  return null
}

function lookupCardInfo(title: string, cardholderName: string | null): IssuerInfo | null {
  const hay = `${title} ${cardholderName ?? ''}`.toLowerCase()
  for (const [needle, info] of Object.entries(CARD_ISSUER_INFO)) {
    if (hay.includes(needle)) return info
  }
  return null
}

function deriveAccountType(title: string): string | null {
  const t = title.toLowerCase()
  if (t.includes('checking')) return 'Checking'
  if (t.includes('savings') || t.includes('saving')) return 'Savings'
  if (t.includes('investment')) return 'Investment'
  if (t.includes('money market')) return 'Money Market'
  return null
}

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  const rows = await db
    .select()
    .from(entries)
    .where(or(eq(entries.type, 'bank_account'), eq(entries.type, 'credit_card')))

  const decrypted = decryptEntries(rows)

  let updates = 0
  let untouched = 0

  for (const e of decrypted) {
    const patch: Record<string, string> = {}

    if (e.type === 'bank_account') {
      const info = lookupBankInfo(e.bankName, e.title)
      if (info) {
        if (!e.phone) patch.phone = info.phone
        if (!e.url) patch.url = info.url
      }
      if (!e.accountType) {
        const derived = deriveAccountType(e.title)
        if (derived) patch.accountType = derived
      }
    } else {
      const info = lookupCardInfo(e.title, e.cardholderName)
      if (info) {
        if (!e.phone) patch.phone = info.phone
        if (!e.url) patch.url = info.url
      }
    }

    if (Object.keys(patch).length === 0) {
      untouched++
      continue
    }

    updates++
    console.log(`${APPLY ? 'UPDATE' : 'would update'}: ${e.title}`)
    for (const [k, v] of Object.entries(patch)) {
      console.log(`    ${k} → ${v}`)
    }

    if (APPLY) {
      await db.update(entries).set(patch).where(eq(entries.id, e.id))
    }
  }

  console.log(`\n${updates} entries ${APPLY ? 'updated' : 'would be updated'}, ${untouched} already complete or unmatchable.`)
  if (!APPLY && updates > 0) console.log('Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
