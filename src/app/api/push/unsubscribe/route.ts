// Counterpart to /api/push/subscribe — drops the row when the user
// disables notifications in Settings. Idempotent (no-op if not found).
//
// Body: { endpoint: string }

import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { pushSubscriptions } from '@/lib/db/schema'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const endpoint = body.endpoint?.trim()
  if (!endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }

  // Scope to userId so one user can't drop another user's subscription.
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, session.user.id),
      ),
    )

  return NextResponse.json({ ok: true })
}
