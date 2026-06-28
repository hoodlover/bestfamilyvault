import 'server-only'

import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { db } from './db'
import { entries, balanceHistory } from './db/schema'

export interface PriceCreepAlert {
  entryId: string
  title: string
  type: string
  /** ABSOLUTE values, not signed — for recurring bills the magnitude
   *  of the charge is what matters, even though credit-card balance
   *  is stored signed. */
  prevAmountCents: number
  currentAmountCents: number
  pctChange: number  // 0.20 = 20% increase
  prevPeriodEnd: Date
  currentPeriodEnd: Date
}

const ALERT_THRESHOLD = 0.20  // ≥20% jump triggers an alert

/**
 * Find recurring entries whose most recent statement amount jumped
 * meaningfully versus the prior statement. Returns alerts ranked by
 * dollar impact (largest absolute increase first).
 *
 * Visibility mirrors dashboard rules: isPersonal owner-only,
 * isPrivate superuser-only.
 */
export async function detectPriceCreep(userId: string, role: string): Promise<PriceCreepAlert[]> {
  const isSuperuser = role === 'superuser'

  // Find all isRecurring entries the user can see.
  const recurringEntries = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
    })
    .from(entries)
    .where(and(
      eq(entries.isRecurring, true),
      isSuperuser ? undefined : eq(entries.isPrivate, false),
      or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      isNull(entries.parentEntryId),
    ))

  const alerts: PriceCreepAlert[] = []

  for (const e of recurringEntries) {
    // Pull the two most recent balance_history rows for this entry.
    const history = await db
      .select({
        balanceCents: balanceHistory.balanceCents,
        periodEnd: balanceHistory.periodEnd,
      })
      .from(balanceHistory)
      .where(eq(balanceHistory.entryId, e.id))
      .orderBy(desc(balanceHistory.periodEnd))
      .limit(2)

    if (history.length < 2) continue
    const [latest, prev] = history

    // Compare absolute values (a credit-card going from -100 to -150
    // is a 50% increase in what's owed, not a "decrease").
    const cur = Math.abs(latest.balanceCents)
    const prv = Math.abs(prev.balanceCents)
    if (prv === 0) continue
    const pct = (cur - prv) / prv
    if (pct < ALERT_THRESHOLD) continue

    alerts.push({
      entryId: e.id,
      title: e.title,
      type: e.type,
      prevAmountCents: prv,
      currentAmountCents: cur,
      pctChange: pct,
      prevPeriodEnd: prev.periodEnd,
      currentPeriodEnd: latest.periodEnd,
    })
  }

  // Largest absolute dollar increase first.
  alerts.sort((a, b) => (b.currentAmountCents - b.prevAmountCents) - (a.currentAmountCents - a.prevAmountCents))
  return alerts
}
