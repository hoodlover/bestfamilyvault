// Daily cron — push a single nudge per user for every bank/credit-card
// statement that should be available now (i.e. predicted arrival date
// passed ≥2 days ago and no fresh statement was imported since).
//
// One batched push per user per day. Idempotency via reminders_sent
// kind='statement-drop' (entryId=null since this kind is user-batched
// rather than per-entry).
//
// Auth: same Bearer $CRON_SECRET pattern as the other crons.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, remindersSent } from '@/lib/db/schema'
import { predictStatementDropForUser } from '@/lib/statement-predict'
import { sendPushToUser } from '@/lib/push'

export const runtime = 'nodejs'
export const maxDuration = 60

const KIND = 'statement-drop'

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildPushBody(titles: string[]): { title: string; body: string } {
  if (titles.length === 1) {
    return {
      title: `${titles[0]} statement should be available`,
      body: 'Drop the PDF in your Vault File Drop folder.',
    }
  }
  // Truncate list once it gets long — Android caps notification body
  // around ~200 chars and we don't want a 12-account ellipsis.
  const head = titles.slice(0, 3).join(', ')
  const rest = titles.length - 3
  const list = rest > 0 ? `${head}, and ${rest} more` : head
  return {
    title: `${titles.length} statements should be available`,
    body: `${list}. Drop them in Vault File Drop.`,
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const today = ymd(new Date())

  // Every active user — recurring entries are per-user so prediction
  // runs per-user too.
  const allUsers = await db.select({ id: users.id }).from(users)

  let sentCount = 0
  let skippedAlready = 0
  let skippedNothing = 0
  const errors: Array<{ userId: string; error: string }> = []
  const debug: Array<{ userId: string; overdue: string[]; skipped: number }> = []

  for (const u of allUsers) {
    try {
      const { overdue, skipped } = await predictStatementDropForUser(u.id)
      debug.push({ userId: u.id, overdue: overdue.map((o) => o.title), skipped: skipped.length })

      if (overdue.length === 0) {
        skippedNothing++
        continue
      }

      // Idempotency: did we send today's batched reminder to this user?
      const already = await db
        .select({ id: remindersSent.id })
        .from(remindersSent)
        .where(
          and(
            eq(remindersSent.userId, u.id),
            eq(remindersSent.kind, KIND),
            eq(remindersSent.forDate, today),
            isNull(remindersSent.entryId),
          ),
        )
        .limit(1)

      if (already.length > 0) {
        skippedAlready++
        continue
      }

      const { title, body } = buildPushBody(overdue.map((o) => o.title))

      await sendPushToUser(u.id, {
        title,
        body,
        url: '/import',
        tag: 'statement-drop-batch',
      })

      await db.insert(remindersSent).values({
        userId: u.id,
        kind: KIND,
        forDate: today,
        entryId: null,
      })

      sentCount++
    } catch (err) {
      errors.push({ userId: u.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  console.log(
    `[${new Date().toISOString()}] statement-drop-reminders run: sent=${sentCount} skippedAlready=${skippedAlready} skippedNothing=${skippedNothing} errors=${errors.length}`,
  )

  return NextResponse.json({
    forDate: today,
    sent: sentCount,
    skippedAlready,
    skippedNothing,
    errors,
    debug,
  })
}
