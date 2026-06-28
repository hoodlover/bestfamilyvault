import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { ilike } from 'drizzle-orm'

async function main() {
  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      currentBalance: entries.currentBalance,
      balanceAsOf: entries.balanceAsOf,
      isPersonal: entries.isPersonal,
      isPrivate: entries.isPrivate,
      parentEntryId: entries.parentEntryId,
    })
    .from(entries)
    .where(ilike(entries.title, '%Axos%'))

  console.log(`Found ${rows.length} Axos entries:\n`)
  for (const r of rows) {
    console.log(`  ${r.title}`)
    console.log(`    type:            ${r.type}`)
    console.log(`    currentBalance:  ${r.currentBalance == null ? 'NULL (not in net-worth)' : '$' + (r.currentBalance / 100).toFixed(2)}`)
    console.log(`    balanceAsOf:     ${r.balanceAsOf ?? 'n/a'}`)
    console.log(`    parent:          ${r.parentEntryId ?? '(top-level)'}`)
    console.log(`    isPersonal:      ${r.isPersonal}, isPrivate: ${r.isPrivate}`)
    console.log()
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
