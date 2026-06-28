import 'server-only'

import { and, desc, eq, isNotNull, isNull, or, sql, gte, lte, inArray } from 'drizzle-orm'
import { db } from './db'
import { entries, subcategories, balanceHistory, statementLineItems } from './db/schema'

export interface LlcSnapshot {
  /** Slug we resolved (echoed back so callers can verify). */
  llcSlug: string
  /** Friendly name of the LLC subcategory ("Path to Change, LLC") — for the header. */
  llcLabel: string | null
  /** Sum of currentBalance across LLC-tagged entries the user can see. cents. */
  balanceCents: number
  /** Balance ~30 days ago (from balance_history). null if no history that far back. */
  prevBalanceCents: number | null
  /** Most recent balanceAsOf across contributing entries. */
  asOf: Date | null
  /** Number of LLC-tagged entries contributing to balanceCents. */
  contributingCount: number
  /** YTD inflows (sum of positive statement_line_item.amountCents this calendar year). */
  ytdInflowCents: number
  /** YTD outflows (absolute value of sum of negative line items this year). */
  ytdOutflowCents: number
  /** Total number of LLC line items posted this year. */
  ytdLineCount: number
}

/**
 * Per-LLC dashboard snapshot — current balance + 30-day delta + YTD
 * activity for every entry tagged with the given LLC subcategory slug.
 * Mirrors the visibility model used by getNetWorth (isPersonal owner-only,
 * isPrivate superuser-only).
 *
 * Returns a zero-snapshot if the LLC subcategory doesn't exist or no
 * entries are tagged with it — caller decides whether to render anything.
 */
export async function getLlcSnapshot(
  userId: string,
  role: string,
  llcSlug: string,
): Promise<LlcSnapshot> {
  const isSuperuser = role === 'superuser'

  // Resolve LLC subcategory.id from its slug. We match on slug because slugs
  // are stable across re-seeds, unlike UUIDs.
  const llcSub = await db
    .select({ id: subcategories.id, name: subcategories.name })
    .from(subcategories)
    .where(eq(subcategories.slug, llcSlug))
    .then((r) => r[0])

  const emptySnapshot = (label: string | null): LlcSnapshot => ({
    llcSlug,
    llcLabel: label,
    balanceCents: 0,
    prevBalanceCents: null,
    asOf: null,
    contributingCount: 0,
    ytdInflowCents: 0,
    ytdOutflowCents: 0,
    ytdLineCount: 0,
  })

  if (!llcSub) return emptySnapshot(null)

  // Pull LLC-tagged entries the user can see. Filter to ones that have a
  // currentBalance so the totals only reflect tracked accounts. We also
  // capture the entry IDs separately for the statement-line-items join.
  const taggedRows = await db
    .select({
      id: entries.id,
      currentBalance: entries.currentBalance,
      balanceAsOf: entries.balanceAsOf,
    })
    .from(entries)
    .where(
      and(
        eq(entries.llcSubcategoryId, llcSub.id),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isNull(entries.parentEntryId),
      ),
    )

  let balanceCents = 0
  let asOf: Date | null = null
  const contributingIds: string[] = []
  for (const r of taggedRows) {
    if (r.currentBalance == null) continue
    balanceCents += r.currentBalance
    if (r.balanceAsOf && (!asOf || r.balanceAsOf > asOf)) asOf = r.balanceAsOf
    contributingIds.push(r.id)
  }

  // 30-day prior balance — sum the latest balance_history row dated <=
  // (now - 30d) for each contributing entry. Identical pattern to
  // getNetWorth(). Skip the lookup entirely when there's nothing to sum.
  let prevBalanceCents: number | null = null
  if (contributingIds.length > 0) {
    const cutoff = new Date(Date.now() - 30 * 86_400_000)
    let havePrior = false
    let runningPrev = 0
    for (const id of contributingIds) {
      const prior = await db
        .select({ balanceCents: balanceHistory.balanceCents })
        .from(balanceHistory)
        .where(and(
          eq(balanceHistory.entryId, id),
          sql`${balanceHistory.periodEnd} <= ${cutoff}`,
        ))
        .orderBy(desc(balanceHistory.periodEnd))
        .limit(1)
        .then((r) => r[0])
      if (prior) {
        runningPrev += prior.balanceCents
        havePrior = true
      } else {
        // No history that old — assume balance was unchanged so the delta
        // doesn't lie.
        const cur = taggedRows.find((r) => r.id === id)?.currentBalance ?? 0
        runningPrev += cur
      }
    }
    prevBalanceCents = havePrior ? runningPrev : null
  }

  // YTD inflows / outflows. We pull statement_line_items for every entry
  // tagged with this LLC (including ones without currentBalance — they
  // still carry transactions). The userId scope on line items already
  // matches the per-user visibility model.
  const allTaggedEntryIds = (await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.llcSubcategoryId, llcSub.id),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
  ).map((r) => r.id)

  let ytdInflowCents = 0
  let ytdOutflowCents = 0
  let ytdLineCount = 0
  if (allTaggedEntryIds.length > 0) {
    // Posted-date strings are YYYY-MM-DD; this comparison is text-safe
    // because ISO dates sort lexicographically.
    // We compute "this year" off the most-recent statement we've imported
    // for the LLC (or today if no statements yet). Using "today" works
    // for ongoing accounts but a stale demo DB would skip everything;
    // either way the YTD count tells the user when it's empty.
    const yearStart = `${new Date().getUTCFullYear()}-01-01`
    const yearEnd = `${new Date().getUTCFullYear()}-12-31`
    const lineRows = await db
      .select({ amountCents: statementLineItems.amountCents })
      .from(statementLineItems)
      .where(
        and(
          inArray(statementLineItems.accountEntryId, allTaggedEntryIds),
          gte(statementLineItems.postedDate, yearStart),
          lte(statementLineItems.postedDate, yearEnd),
        ),
      )
    ytdLineCount = lineRows.length
    for (const row of lineRows) {
      if (row.amountCents >= 0) ytdInflowCents += row.amountCents
      else ytdOutflowCents += -row.amountCents
    }
  }

  return {
    llcSlug,
    llcLabel: llcSub.name,
    balanceCents,
    prevBalanceCents,
    asOf,
    contributingCount: contributingIds.length,
    ytdInflowCents,
    ytdOutflowCents,
    ytdLineCount,
  }
}
