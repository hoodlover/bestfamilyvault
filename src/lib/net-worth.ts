import 'server-only'

import { and, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from './db'
import { entries, balanceHistory } from './db/schema'
import { classifyGroup } from './net-worth-shared'
import type { NetWorthItem, NetWorthSnapshot } from './net-worth-shared'

// Re-export the client-safe pieces so existing server importers (digest,
// dashboard page, etc.) can keep importing from '@/lib/net-worth'. The
// client NetWorthCard pulls these direct from '@/lib/net-worth-shared'.
export type { NetWorthSnapshot, NetWorthItem, NetWorthGroup } from './net-worth-shared'
export { NET_WORTH_GROUP_META } from './net-worth-shared'

/**
 * Compute the user's net-worth snapshot from currentBalance fields on
 * accessible entries. Mirrors dashboard visibility rules: isPersonal
 * is owner-only (superuser does NOT bypass); isPrivate is superuser-only.
 *
 * Pre-Phase-2 entries (no currentBalance set) contribute nothing — they
 * fall through silently.
 */
export async function getNetWorth(userId: string, role: string): Promise<NetWorthSnapshot> {
  const isSuperuser = role === 'superuser'

  const rows = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      accountType: entries.accountType,
      currentBalance: entries.currentBalance,
      balanceAsOf: entries.balanceAsOf,
    })
    .from(entries)
    .where(
      and(
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isNull(entries.parentEntryId),
        isNotNull(entries.currentBalance),
      ),
    )

  let totalCents = 0
  let assetsCents = 0
  let debtsCents = 0
  let asOf: Date | null = null
  const items: NetWorthItem[] = []

  for (const r of rows) {
    if (r.currentBalance == null) continue
    totalCents += r.currentBalance
    if (r.currentBalance >= 0) assetsCents += r.currentBalance
    else debtsCents += -r.currentBalance
    if (r.balanceAsOf && (!asOf || r.balanceAsOf > asOf)) asOf = r.balanceAsOf
    items.push({
      entryId: r.id,
      title: r.title,
      type: r.type,
      group: classifyGroup(r.type, r.accountType),
      balanceCents: r.currentBalance,
      asOf: r.balanceAsOf,
    })
  }

  // Sort once by absolute balance — the card displays top 6 by default
  // and reveals the rest behind an expand toggle.
  items.sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents))

  // Prior-snapshot lookup: ~30 days ago. For each contributing entry,
  // pull the most recent balance_history row dated <= (now - 30 days).
  // Sum those for the prior total. If we don't have ANY history for an
  // entry going back that far, skip it from the prior snapshot (so the
  // delta only reflects what we actually have).
  let prevTotalCents: number | null = null
  if (items.length > 0) {
    const cutoff = new Date(Date.now() - 30 * 86_400_000)
    let havePrior = false
    let runningPrev = 0
    for (const item of items) {
      const prior = await db
        .select({ balanceCents: balanceHistory.balanceCents })
        .from(balanceHistory)
        .where(and(
          eq(balanceHistory.entryId, item.entryId),
          sql`${balanceHistory.periodEnd} <= ${cutoff}`,
        ))
        .orderBy(desc(balanceHistory.periodEnd))
        .limit(1)
        .then((r) => r[0])
      if (prior) {
        runningPrev += prior.balanceCents
        havePrior = true
      } else {
        // No 30-day-old history for this entry — treat its prior as
        // its current (so it doesn't show a fake big delta).
        runningPrev += item.balanceCents
      }
    }
    prevTotalCents = havePrior ? runningPrev : null
  }

  return {
    totalCents,
    assetsCents,
    debtsCents,
    contributingCount: items.length,
    asOf,
    prevTotalCents,
    items,
  }
}
