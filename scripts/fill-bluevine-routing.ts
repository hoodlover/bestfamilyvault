// Fill the routing number on every Bluevine bank_account entry. Safe
// to auto-fill because every Bluevine account, regardless of which
// LLC sub-account it is, routes through Coastal Community Bank with
// the same routing number — Bluevine doesn't operate its own bank.
//
// Idempotent: skips any entry where routingNumber is already populated.
// Dry-run by default; --apply commits.

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq, and, ilike } from 'drizzle-orm'
import { decryptEntries, encrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

// Coastal Community Bank — Bluevine's banking partner. Single source
// of truth across all Bluevine sub-accounts. Encrypted at rest like
// every other routing number.
const BLUEVINE_ROUTING = '121145349'

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.type, 'bank_account'), ilike(entries.bankName, '%bluevine%')))
  const decrypted = decryptEntries(rows)

  let updated = 0
  let skipped = 0

  for (const e of decrypted) {
    if (e.routingNumber && e.routingNumber.trim() !== '') {
      console.log(`  · ${e.title}  — already has routing (${e.routingNumber}) — skipping`)
      skipped++
      continue
    }
    console.log(`${APPLY ? 'UPDATE' : 'would update'}: ${e.title}`)
    console.log(`    routingNumber → ${BLUEVINE_ROUTING}`)
    if (APPLY) {
      await db
        .update(entries)
        .set({ routingNumber: encrypt(BLUEVINE_ROUTING) ?? '' })
        .where(eq(entries.id, e.id))
    }
    updated++
  }

  console.log(
    `\n${updated} entries ${APPLY ? 'updated' : 'would be updated'}, ${skipped} already had a routing number.`,
  )
  if (!APPLY && updated > 0) console.log('Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
