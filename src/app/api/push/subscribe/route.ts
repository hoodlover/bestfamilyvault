// Saves a PushSubscription the browser handed us at subscribe time so
// the server can later send notifications to that exact device.
//
// Body shape — whatever JSON.stringify(pushSubscription) yielded on the
// client. The interesting bits are endpoint + keys.p256dh + keys.auth.
//
// Idempotent: upsert keyed on endpoint. Same device re-subscribing (e.g.
// after clearing the SW) just refreshes keys + userId.

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { pushSubscriptions } from '@/lib/db/schema'

export const runtime = 'nodejs'

interface IncomingSubscription {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IncomingSubscription
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const endpoint = body.endpoint?.trim()
  const p256dh = body.keys?.p256dh?.trim()
  const auth_ = body.keys?.auth?.trim()
  if (!endpoint || !p256dh || !auth_) {
    return NextResponse.json({ error: 'Missing endpoint or keys' }, { status: 400 })
  }

  const userAgent = req.headers.get('user-agent') ?? null
  const userId = session.user.id

  // Upsert: if the endpoint already exists, refresh ownership + keys.
  // Otherwise insert. ON CONFLICT keys to the unique endpoint index.
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth: auth_, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh,
        auth: auth_,
        userAgent,
        failureCount: 0,
        lastErrorAt: null,
      },
    })

  return NextResponse.json({ ok: true })
}

// Quick existence probe used by NotificationToggle on mount — lets the UI
// show "already subscribed on this device" without re-running the whole
// permission/subscribe dance.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const endpoint = req.nextUrl.searchParams.get('endpoint')
  if (!endpoint) return NextResponse.json({ subscribed: false })
  const row = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1)
  return NextResponse.json({ subscribed: row.length > 0 })
}
