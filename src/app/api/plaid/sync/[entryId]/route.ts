// Pulls fresh transactions + current balance from Plaid for one entry,
// writes the new transactions to statement_line_items, and refreshes
// the entry's currentBalance / balanceAsOf. Each call burns one
// transactions/sync request against the Plaid quota — manual trigger
// only (no cron) so the user controls when those calls happen.
//
// The sync is incremental: the entry's plaid_cursor stores the last
// position from Plaid; the next call returns only added/modified
// transactions since then. First call after Link returns the
// historical baseline (typically ~24 months on most banks). We loop
// while Plaid says has_more so a deep first-sync drains in one click.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, statementLineItems, balanceHistory } from '@/lib/db/schema'
import { plaid } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { normalizeMerchant } from '@/lib/recurring-detect'

export const runtime = 'nodejs'
// Plaid first-syncs can pull 24 months of history — allow time.
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ entryId: string }>
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role === 'readonly') {
    return NextResponse.json({ error: 'Read-only access.' }, { status: 403 })
  }

  const { entryId } = await ctx.params
  const entry = await db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .then((r) => r[0])
  if (!entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })

  const isSuperuser = session.user.role === 'superuser'
  if (entry.isPrivate && !isSuperuser) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (entry.isPersonal && entry.createdBy !== session.user.id) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (!entry.plaidAccessToken || !entry.plaidAccountId) {
    return NextResponse.json({ error: 'This entry is not linked to Plaid.' }, { status: 400 })
  }

  const accessToken = decrypt(entry.plaidAccessToken)
  if (!accessToken) {
    return NextResponse.json({ error: 'Failed to decrypt Plaid access token.' }, { status: 500 })
  }

  let cursor = entry.plaidCursor ?? undefined
  let added: Array<{
    transaction_id: string
    account_id: string
    amount: number
    date: string
    name: string | null
    merchant_name?: string | null
  }> = []
  let pageCount = 0
  let hasMore = true

  try {
    while (hasMore) {
      // Hard cap on pages so a runaway has_more=true loop can't burn
      // the whole quota in one call. 10 pages × 500 txns = 5000 — more
      // than any single sync should ever need.
      if (++pageCount > 10) break

      const res = await plaid().transactionsSync({
        access_token: accessToken,
        cursor,
        // count is intentionally omitted — Plaid uses 100 as default
        // and that fits well inside any single response budget.
      })
      added = added.concat(
        res.data.added.map((t) => ({
          transaction_id: t.transaction_id,
          account_id: t.account_id,
          amount: t.amount,
          date: t.date,
          name: t.name,
          merchant_name: t.merchant_name,
        })),
      )
      cursor = res.data.next_cursor
      hasMore = res.data.has_more
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plaid/sync] transactionsSync failed:', msg)
    return NextResponse.json({ error: `Plaid sync failed: ${msg}` }, { status: 500 })
  }

  // Filter to JUST the pinned account — a Plaid Item can return rows
  // for multiple accounts under the same login, but each vault entry
  // mirrors exactly one.
  const myAccountId = entry.plaidAccountId
  const ourAdds = added.filter((t) => t.account_id === myAccountId)

  // Map to statement_line_items. Plaid's sign convention is the
  // opposite of this app's: positive `amount` from Plaid = outflow
  // (debit); our statement convention is negative = debit. So negate.
  const rows = ourAdds
    .filter((t) => t.date && Number.isFinite(t.amount))
    .map((t) => {
      const descr = (t.merchant_name?.trim() || t.name?.trim() || '(unknown)')
      return {
        userId: entry.createdBy,
        accountEntryId: entry.id,
        sourceFileId: null,
        statementDate: null,
        postedDate: t.date,
        rawDescription: descr,
        normalizedMerchant: normalizeMerchant(descr),
        amountCents: Math.round(-t.amount * 100),
        currency: 'USD',
      }
    })

  if (rows.length > 0) {
    // onConflictDoNothing keys to the dedup unique index on
    // (account, postedDate, amount, normalizedMerchant). A re-sync
    // overlapping with an earlier statement-PDF import is safe.
    await db.insert(statementLineItems).values(rows).onConflictDoNothing()
  }

  // Pull the current balance from Plaid in the same trip — costs an
  // extra accounts/balance/get call but updates the dashboard cleanly.
  let balanceUpdated = false
  try {
    const balRes = await plaid().accountsBalanceGet({
      access_token: accessToken,
      options: { account_ids: [myAccountId] },
    })
    const acct = balRes.data.accounts.find((a) => a.account_id === myAccountId)
    if (acct?.balances) {
      const live = acct.balances.current ?? acct.balances.available ?? null
      if (live != null) {
        // Plaid returns positive numbers for both deposit and credit
        // balances. For a credit_card entry, that "balance" represents
        // money OWED — negate to fit this app's signed convention.
        const cents = entry.type === 'credit_card'
          ? Math.round(-live * 100)
          : Math.round(live * 100)
        const periodEnd = new Date()
        await db
          .update(entries)
          .set({
            currentBalance: cents,
            balanceAsOf: periodEnd,
            updatedAt: new Date(),
          })
          .where(eq(entries.id, entry.id))
        await db.insert(balanceHistory).values({
          entryId: entry.id,
          balanceCents: cents,
          periodEnd,
          sourceFileId: null,
        })
        balanceUpdated = true
      }
    }
  } catch (err) {
    // Balance lookup failed but transactions DID land — don't fail the
    // whole sync. The cursor + txn writes above are the load-bearing
    // part; balance can refresh on the next sync.
    console.warn('[plaid/sync] accountsBalanceGet failed:', err instanceof Error ? err.message : String(err))
  }

  // Stamp the cursor + sync time so the next call is incremental.
  await db
    .update(entries)
    .set({
      plaidCursor: cursor ?? null,
      plaidSyncedAt: new Date(),
    })
    .where(and(eq(entries.id, entry.id)))

  return NextResponse.json({
    ok: true,
    transactionsAdded: rows.length,
    pagesPulled: pageCount,
    balanceUpdated,
  })
}
