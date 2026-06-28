// Web Push wrapper used by the reminder crons (and any other server-side
// code that needs to nudge a user). Wraps the `web-push` library + the
// `push_subscription` table so callers just say:
//
//   await sendPushToUser(userId, { title: 'X', body: 'Y', url: '/foo' })
//
// We iterate every subscription the user has (one per opted-in device),
// fire-and-await each, and prune dead ones. A subscription is "dead" when
// the push service answers 410 Gone or 404 Not Found — those mean the
// browser revoked the token and resending will never succeed. We bump
// `failure_count` per non-fatal error and delete the row after 3 strikes
// so silent failures don't accumulate forever.

import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pushSubscriptions } from '@/lib/db/schema'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

export interface PushPayload {
  title: string
  body: string
  /** Path the SW should openWindow() on click. Defaults to /dashboard. */
  url?: string
  /** Notification grouping key — repeat sends with the same tag REPLACE
   *  rather than stack. Use for "today's statement reminder" etc. */
  tag?: string
  /** Tells the SW to add requireInteraction:true so the notification
   *  stays in the shade until the user dismisses it instead of fading
   *  out. Use for time-critical alerts (user-set reminders) — leave
   *  off for routine digests so they don't pile up. */
  requireInteraction?: boolean
}

/** Web-push urgency hint. Android uses this to decide whether to show
 *  the notification as a slide-down heads-up banner vs a quiet entry
 *  in the tray. Default 'normal' for routine notifications; 'high' for
 *  time-critical reminders the user explicitly scheduled. */
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high'

export interface SendResult {
  total: number
  sent: number
  failed: number
  pruned: number
}

export interface SendOptions {
  /** Per-send web-push urgency. 'high' is what gets the heads-up
   *  banner treatment on Android — use it for time-critical pushes
   *  (user-set reminders). Default is 'normal'. */
  urgency?: PushUrgency
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  opts?: SendOptions,
): Promise<SendResult> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) {
    console.warn('[push] VAPID keys not configured — skipping send')
    return { total: 0, sent: 0, failed: 0, pruned: 0 }
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))

  const body = JSON.stringify(payload)
  const result: SendResult = { total: subs.length, sent: 0, failed: 0, pruned: 0 }
  // urgency rides as a top-level web-push option (not in the body).
  // 'normal' is the wire default; 'high' is what convinces Android to
  // run the heads-up animation rather than dropping the notification
  // quietly into the shade.
  const sendOpts = opts?.urgency ? { urgency: opts.urgency } : undefined

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        sendOpts,
      )
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date(), failureCount: 0 })
        .where(eq(pushSubscriptions.id, sub.id))
      result.sent += 1
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode
      // 410 Gone / 404 Not Found = browser revoked the token. Stop trying.
      if (status === 410 || status === 404) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        result.pruned += 1
        continue
      }
      // Other errors (network, 5xx) — bump failure counter; drop after 3.
      const nextCount = (sub.failureCount ?? 0) + 1
      if (nextCount >= 3) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        result.pruned += 1
      } else {
        await db
          .update(pushSubscriptions)
          .set({ failureCount: nextCount, lastErrorAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id))
      }
      result.failed += 1
      console.error('[push] send failed', { userId, endpoint: sub.endpoint, status, err })
    }
  }

  return result
}
