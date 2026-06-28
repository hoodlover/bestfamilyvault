// Predicts when each bank/credit-card account's next statement should
// arrive in the Vault File Drop folder, based on the cadence of past
// statements already attached to that account entry.
//
// Algorithm (intentionally simple — fancy time-series is overkill for
// "Chase posts on the 17th every month"):
//   - Use the createdAt timestamp of each attached PDF as the statement's
//     arrival date. Statements get imported close to receipt, so it's a
//     reliable proxy.
//   - Need ≥3 statements to predict — fewer signals weren't reliable
//     enough in spot-checks and produced false alarms on freshly-added
//     accounts.
//   - Median pairwise interval (days between consecutive statements)
//     classifies cadence: 26-34 → monthly, 84-100 → quarterly. Anything
//     else → irregular, skip the account entirely. Better to under-remind
//     than annoy with a wrong prediction.
//   - Predicted next = last statement's date + median interval. A 2-day
//     grace window past that point is "overdue".
//
// Returns the list of overdue accounts for a user so the cron can batch
// them into a single push.

import { and, eq, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, files } from '@/lib/db/schema'

export interface OverdueAccount {
  entryId: string
  title: string
  cadence: 'monthly' | 'quarterly'
  lastStatementAt: Date
  predictedNextAt: Date
  daysOverdue: number
}

interface PredictionDebug {
  entryId: string
  title: string
  reason: string
}

export interface StatementPredictionResult {
  overdue: OverdueAccount[]
  /** Accounts that were skipped, with reason — useful for debugging the cron. */
  skipped: PredictionDebug[]
}

const GRACE_DAYS = 2

export async function predictStatementDropForUser(userId: string): Promise<StatementPredictionResult> {
  // All accounts (banks + cards) owned by this user.
  const accounts = await db
    .select({ id: entries.id, title: entries.title, type: entries.type })
    .from(entries)
    .where(
      and(
        eq(entries.createdBy, userId),
        // entries.type is an enum — filter via OR
      ),
    )

  const result: StatementPredictionResult = { overdue: [], skipped: [] }

  for (const acct of accounts) {
    if (acct.type !== 'credit_card' && acct.type !== 'bank_account') continue

    // PDF statements attached to this account, newest first.
    const statements = await db
      .select({ createdAt: files.createdAt })
      .from(files)
      .where(
        and(
          eq(files.entryId, acct.id),
          like(files.contentType, 'application/pdf%'),
        ),
      )

    statements.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (statements.length < 3) {
      result.skipped.push({ entryId: acct.id, title: acct.title, reason: `only ${statements.length} statements` })
      continue
    }

    // Use the most recent 6 for the median calc — older statements may
    // reflect a long-since-changed cadence.
    const recent = statements.slice(0, 6).map((s) => s.createdAt)

    const intervals: number[] = []
    for (let i = 0; i < recent.length - 1; i += 1) {
      const days = Math.round((recent[i].getTime() - recent[i + 1].getTime()) / (24 * 60 * 60 * 1000))
      if (days > 0) intervals.push(days)
    }
    if (intervals.length === 0) {
      result.skipped.push({ entryId: acct.id, title: acct.title, reason: 'no positive intervals' })
      continue
    }

    const medianInterval = median(intervals)
    let cadence: 'monthly' | 'quarterly'
    if (medianInterval >= 26 && medianInterval <= 34) cadence = 'monthly'
    else if (medianInterval >= 84 && medianInterval <= 100) cadence = 'quarterly'
    else {
      result.skipped.push({
        entryId: acct.id,
        title: acct.title,
        reason: `irregular cadence (median ${medianInterval}d)`,
      })
      continue
    }

    const last = recent[0]
    const predicted = new Date(last)
    predicted.setDate(predicted.getDate() + medianInterval)

    const now = new Date()
    const msPerDay = 24 * 60 * 60 * 1000
    const daysOverdue = Math.floor((now.getTime() - predicted.getTime()) / msPerDay)

    if (daysOverdue >= GRACE_DAYS) {
      result.overdue.push({
        entryId: acct.id,
        title: acct.title,
        cadence,
        lastStatementAt: last,
        predictedNextAt: predicted,
        daysOverdue,
      })
    }
  }

  return result
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
