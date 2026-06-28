// Polls user-scheduled reminders. Scans for rows where remind_at has
// elapsed and sent_at is still null, fires a web-push per row, then
// stamps sent_at so the same row never fires twice.
//
// Cron schedule lives in vercel.json — runs every 5 minutes. Auth: same
// Bearer $CRON_SECRET pattern as the other crons.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reminders } from '@/lib/db/schema'
import { sendPushToUser } from '@/lib/push'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const now = new Date()
  // 200-row cap is a defence against a one-time backlog blowing the
  // cron's 60s budget — each push round-trips to the browser push
  // service. A real backlog gets caught up on the next 5-min tick.
  const due = await db
    .select()
    .from(reminders)
    .where(and(isNull(reminders.sentAt), lte(reminders.remindAt, now)))
    .limit(200)

  let sent = 0
  let failed = 0
  const errors: Array<{ reminderId: string; error: string }> = []

  for (const r of due) {
    try {
      // Resolve the tap-deep-link from whichever parent is attached.
      // No parent → /reminders (the inbox view).
      const url = r.noteId
        ? `/notes/${r.noteId}`
        : r.todoListId
          ? `/todos/${r.todoListId}`
          : '/reminders'

      // Always send a non-empty title + body. Empty strings get replaced
      // by Chrome with its generic "site updated" notification on some
      // platforms — even with a non-empty title — so default the body
      // to a context-aware line that tells the user what to expect.
      const title = (r.title?.trim() || 'Reminder')
      const body = (r.body?.trim()
        || (r.noteId ? 'Tap to open your note.'
          : r.todoListId ? 'Tap to open your list.'
            : 'Tap to open the vault.'))

      await sendPushToUser(
        r.userId,
        {
          title,
          body,
          url,
          // Per-reminder tag so two reminders with overlapping fire times
          // don't collapse onto each other in the notification tray.
          tag: `reminder-${r.id}`,
          // User-set reminders are time-critical — make them sticky in
          // the shade until the user dismisses them, so a quick
          // glance-away doesn't make them disappear.
          requireInteraction: true,
        },
        // 'high' urgency is the wire signal Android needs to show the
        // notification as a slide-down heads-up banner instead of a
        // quiet tray entry. Reserve for reminders the user explicitly
        // scheduled — routine digests stay at default 'normal'.
        { urgency: 'high' },
      )

      await db
        .update(reminders)
        .set({ sentAt: new Date() })
        .where(eq(reminders.id, r.id))

      sent += 1
    } catch (err) {
      failed += 1
      errors.push({
        reminderId: r.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Housekeeping sweep: hard-delete reminders that fired more than 3
  // days ago. The note/todo pages keep the most recent sent ones around
  // for context ("the system DID ping me about this Tuesday"), but a
  // crossed-off row from a week back is noise. 5-min cron tick keeps
  // this near-realtime; the client also hides any sent>3d defensively.
  const sentCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  const sweptResult = await db
    .delete(reminders)
    .where(and(isNotNull(reminders.sentAt), lte(reminders.sentAt, sentCutoff)))
    .returning({ id: reminders.id })
  const swept = sweptResult.length

  console.log(
    `[${new Date().toISOString()}] process-reminders run: due=${due.length} sent=${sent} failed=${failed} swept=${swept}`,
  )

  return NextResponse.json({
    due: due.length,
    sent,
    failed,
    swept,
    errors,
  })
}
