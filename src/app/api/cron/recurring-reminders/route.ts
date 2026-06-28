// Daily cron — push a heads-up to anyone with a recurring entry whose
// subscriptionRenewsAt is 3 days out. Vercel cron schedule lives in
// vercel.json; runs once per day. Idempotency via reminders_sent so a
// same-day re-run is a no-op.
//
// Auth: same Bearer $CRON_SECRET pattern as weekly-digest. Local-dev
// invocation without a secret is allowed.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, remindersSent } from '@/lib/db/schema'
import { sendPushToUser } from '@/lib/push'

export const runtime = 'nodejs'
export const maxDuration = 60

const KIND = 'recurring-3d'
const LEAD_DAYS = 3

// Format a Date as YYYY-MM-DD using local-server semantics. The
// subscriptionRenewsAt column is a plain YYYY-MM-DD string, not a
// timestamp — keep the math in the same shape to avoid DST drift.
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDollars(cents: number): string {
  if (cents === 0) return '$0'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}$${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Target = today + 3 days, as YYYY-MM-DD. The subscriptionRenewsAt
  // column stores this format, so an equality match is enough — no
  // range check needed.
  const target = new Date()
  target.setDate(target.getDate() + LEAD_DAYS)
  const targetYmd = ymd(target)
  const today = ymd(new Date())

  // All recurring entries renewing exactly LEAD_DAYS from now. Skip
  // archived / soft-deleted entries via createdBy presence (every live
  // entry has a creator).
  const candidates = await db
    .select({
      id: entries.id,
      userId: entries.createdBy,
      title: entries.title,
      amountCents: entries.subscriptionAmountCents,
      period: entries.subscriptionPeriod,
    })
    .from(entries)
    .where(
      and(
        eq(entries.isRecurring, true),
        eq(entries.subscriptionRenewsAt, targetYmd),
        isNotNull(entries.createdBy),
      ),
    )

  let sent = 0
  let skippedDuplicate = 0
  let errors: Array<{ entryId: string; error: string }> = []

  for (const entry of candidates) {
    try {
      // Idempotency check: did we already send this exact reminder today?
      const already = await db
        .select({ id: remindersSent.id })
        .from(remindersSent)
        .where(
          and(
            eq(remindersSent.userId, entry.userId),
            eq(remindersSent.kind, KIND),
            eq(remindersSent.forDate, today),
            eq(remindersSent.entryId, entry.id),
          ),
        )
        .limit(1)
      if (already.length > 0) {
        skippedDuplicate++
        continue
      }

      const amount = entry.amountCents ? formatDollars(entry.amountCents) : null
      const body = amount
        ? `${amount} charges in 3 days.`
        : `Renews in 3 days.`

      await sendPushToUser(entry.userId, {
        title: `Heads up — ${entry.title}`,
        body,
        url: `/entries/${entry.id}`,
        tag: `recurring-3d-${entry.id}`,
      })

      await db.insert(remindersSent).values({
        userId: entry.userId,
        kind: KIND,
        forDate: today,
        entryId: entry.id,
      })

      sent++
    } catch (err) {
      errors.push({
        entryId: entry.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log(
    `[${new Date().toISOString()}] recurring-reminders run: candidates=${candidates.length} sent=${sent} skipped=${skippedDuplicate} errors=${errors.length}`,
  )

  return NextResponse.json({
    targetDate: targetYmd,
    candidates: candidates.length,
    sent,
    skippedDuplicate,
    errors,
  })
}
