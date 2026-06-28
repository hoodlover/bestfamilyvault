'use server'

import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

/**
 * Generate (or rotate) the per-user opaque token used in the
 * /api/calendar/feed/<token>.ics URL. Returns the new token. Old
 * token is invalidated immediately.
 *
 * Calendar apps don't do OAuth — the token IS the auth. Treat it like
 * a password (don't paste in chat, don't email) but also it's
 * regenerable from the same Settings panel any time.
 */
export async function generateCalendarToken(): Promise<{ token: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }

  // 32 random bytes → base64url. Long enough that brute-force is
  // infeasible (256-bit space); short enough to fit in a URL.
  const token = crypto.randomBytes(32).toString('base64url')

  await db.update(users).set({ calendarToken: token }).where(eq(users.id, session.user.id))
  revalidatePath('/settings')
  return { token }
}

export async function clearCalendarToken(): Promise<{ success: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }

  await db.update(users).set({ calendarToken: null }).where(eq(users.id, session.user.id))
  revalidatePath('/settings')
  return { success: true }
}
