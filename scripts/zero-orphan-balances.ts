// One-shot data hygiene: any bank/credit entry whose currentBalance was
// hand-typed or backfilled — but has NO statement file attached — gets
// blanked out so the dashboard reflects reality. Entries with at least
// one attached file keep their figures (the latest-statement import set
// them, anti-clobber rules apply on next import).
//
// Targets only bank_account + credit_card types. Identity / login / note
// entries don't carry a balance so they're skipped.
//
// Run preview first to see what would change:
//   npx tsx --env-file=.env.local scripts/zero-orphan-balances.ts
//
// Then run with --apply to commit:
//   npx tsx --env-file=.env.local scripts/zero-orphan-balances.ts --apply
//
// Idempotent: re-running after applying produces a "0 entries to clear"
// report because the balance is already null.

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, files, balanceHistory } from '@/lib/db/schema'

const DRY_RUN = !process.argv.includes('--apply')

;(async () => {
  console.log(DRY_RUN
    ? '🔍 DRY RUN — pass --apply to commit changes\n'
    : '⚠️  APPLY MODE — changes will be written\n')

  // Pull every bank/credit entry that currently has a balance recorded.
  // Entries with no balance at all are already in the target state.
  const candidates = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      currentBalance: entries.currentBalance,
      balanceAsOf: entries.balanceAsOf,
    })
    .from(entries)
    .where(and(
      or(eq(entries.type, 'bank_account'), eq(entries.type, 'credit_card')),
      isNotNull(entries.currentBalance),
    ))

  if (candidates.length === 0) {
    console.log('No bank/credit entries with balances on record. Nothing to do.')
    process.exit(0)
  }

  // Single batched query for attachment counts — avoids N+1 across the
  // (potentially large) candidate set.
  const candidateIds = candidates.map((c) => c.id)
  const fileRows = await db
    .select({
      entryId: files.entryId,
      count: sql<number>`count(*)::int`,
    })
    .from(files)
    .where(inArray(files.entryId, candidateIds))
    .groupBy(files.entryId)
  const countByEntry = new Map<string, number>()
  for (const r of fileRows) {
    if (r.entryId) countByEntry.set(r.entryId, Number(r.count))
  }

  const orphans = candidates.filter((c) => (countByEntry.get(c.id) ?? 0) === 0)
  const kept = candidates.length - orphans.length

  console.log(`Found ${candidates.length} bank/credit entries with balances on record.`)
  console.log(`  ✓ ${kept} have at least one statement attached — leaving alone`)
  console.log(`  ⚠ ${orphans.length} have ZERO statements attached — flagged for clear\n`)

  if (orphans.length === 0) {
    console.log('Nothing to clear.')
    process.exit(0)
  }

  // Sort by balance descending so the biggest fictions surface first.
  orphans.sort((a, b) => (b.currentBalance ?? 0) - (a.currentBalance ?? 0))

  console.log('Entries to clear:')
  for (const e of orphans) {
    const bal = e.currentBalance != null
      ? `$${(e.currentBalance / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
      : '(null)'
    const asOf = e.balanceAsOf ? e.balanceAsOf.toISOString().slice(0, 10) : '(no date)'
    console.log(`  · ${e.type.padEnd(13)} ${bal.padStart(14)}  as of ${asOf}  →  ${e.title}`)
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete. Re-run with --apply to clear ${orphans.length} ${orphans.length === 1 ? 'entry' : 'entries'}.`)
    process.exit(0)
  }

  // Clear sequentially — currentBalance, balanceAsOf, recentActivity all
  // belong to the "statement landed and set these" cluster, so they
  // travel together. balance_history rows for these entries are also
  // wiped: those rows only exist as a record of past statement imports
  // (sourceFileId points at a file that no longer exists since the user
  // deleted them); without the source file, they're zombie history
  // that would re-stamp the entry on next read.
  //
  // No transaction wrapper here because Neon's HTTP driver doesn't
  // support multi-statement transactions. If the process dies between
  // the two statements you end up with the entry cleared but a stale
  // balance_history row — which a re-run of this script will clean up
  // on the next pass, since the entry no longer has currentBalance set
  // so it won't show up in the candidates list … but the balance_history
  // row is now orphaned. Cheap to live with; if it becomes a real
  // problem we can sweep balance_history for entryIds where the entry
  // has null currentBalance.
  const orphanIds = orphans.map((o) => o.id)
  await db.update(entries).set({
    currentBalance: null,
    balanceAsOf: null,
    recentActivity: null,
  }).where(inArray(entries.id, orphanIds))
  await db.delete(balanceHistory).where(inArray(balanceHistory.entryId, orphanIds))

  console.log(`\n✓ Cleared balances on ${orphans.length} entries.`)
  console.log('  Next statement import for each will set the live balance.')
})()
