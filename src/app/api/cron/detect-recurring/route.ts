// Weekly cron — re-runs recurring-charge detection across every user's
// statement_line_items and refreshes the recurring_suggestion table.
//
// Schedule (vercel.json): Sundays 21:00 UTC = ~17:00 ET. Spaced clear of
// the Saturday email digest and the daily reminder crons.
//
// Auth: Bearer $CRON_SECRET — same pattern as the other cron routes.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, recurringSuggestions } from '@/lib/db/schema'
import {
  detectRecurringForUser,
  filterAlreadyTracked,
  upsertRecurringSuggestions,
} from '@/lib/recurring-detect'
import { sendPushToUser } from '@/lib/push'

export const runtime = 'nodejs'
// Bumped — detection iterates all line items per user; a year of
// statements across 13 accounts can be a few thousand rows.
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const allUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.id))

  let usersProcessed = 0
  let totalInserted = 0
  let totalUpdated = 0
  let usersPushed = 0
  const errors: Array<{ userId: string; error: string }> = []
  const perUser: Array<{ userId: string; candidates: number; inserted: number; updated: number }> = []

  for (const u of allUsers) {
    try {
      const candidates = await detectRecurringForUser(u.id)
      const novel = await filterAlreadyTracked(u.id, candidates)
      const { inserted, updated } = await upsertRecurringSuggestions(u.id, novel)

      perUser.push({ userId: u.id, candidates: candidates.length, inserted, updated })
      totalInserted += inserted
      totalUpdated += updated
      usersProcessed += 1

      // Push if there are NEW pending suggestions this round. Refreshes
      // alone don't trigger — we don't want to nag every Sunday about
      // the same merchants.
      if (inserted > 0) {
        // Count total pending so the body reflects the queue depth, not
        // just this round's deltas.
        const pendingRows = await db
          .select({ id: recurringSuggestions.id })
          .from(recurringSuggestions)
          .where(
            and(
              eq(recurringSuggestions.userId, u.id),
              eq(recurringSuggestions.status, 'pending'),
            ),
          )
        const pending = pendingRows.length
        await sendPushToUser(u.id, {
          title:
            inserted === 1
              ? `1 new recurring charge detected`
              : `${inserted} new recurring charges detected`,
          body:
            pending === inserted
              ? 'Review in Subscriptions.'
              : `${pending} pending total. Review in Subscriptions.`,
          url: '/subscriptions?tab=suggested',
          tag: 'recurring-suggestions',
        })
        usersPushed += 1
      }
    } catch (err) {
      errors.push({ userId: u.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  console.log(
    `[${new Date().toISOString()}] detect-recurring run: users=${usersProcessed} inserted=${totalInserted} updated=${totalUpdated} pushed=${usersPushed} errors=${errors.length}`,
  )

  return NextResponse.json({
    usersProcessed,
    totalInserted,
    totalUpdated,
    usersPushed,
    errors,
    perUser,
  })
}
