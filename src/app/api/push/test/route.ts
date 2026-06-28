// Fires a test push at every device the current user has subscribed.
// Used from the NotificationToggle to confirm subscribe → SW → device.
// No body needed.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sendPushToUser } from '@/lib/push'

export const runtime = 'nodejs'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendPushToUser(session.user.id, {
    title: 'Family Vault reminder test',
    body: 'If you can see this, push notifications are working.',
    url: '/settings',
    tag: 'push-test',
  })

  return NextResponse.json(result)
}
