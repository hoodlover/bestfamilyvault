'use server'

import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { upgradeRequests, users } from '@/lib/db/schema'

const MAX_MESSAGE = 1000

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

async function requireAdmin() {
  const session = await requireUser()
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return session
}

export async function requestUpgrade(formData: FormData) {
  const session = await requireUser()
  const message = ((formData.get('message') as string) ?? '').trim().slice(0, MAX_MESSAGE)
  const requestedRoleRaw = (formData.get('requestedRole') as string | null) ?? null

  if (!message) return { error: 'Please add a short message.' }

  const requestedRole =
    requestedRoleRaw === 'admin' || requestedRoleRaw === 'member' || requestedRoleRaw === 'readonly'
      ? requestedRoleRaw
      : null

  // Cap to one open request per user — overwrite the prior pending message
  const existing = await db
    .select({ id: upgradeRequests.id })
    .from(upgradeRequests)
    .where(eq(upgradeRequests.userId, session.user.id))
    .limit(1)
    .then((r) => r[0])

  if (existing) {
    await db
      .update(upgradeRequests)
      .set({ message, requestedRole, status: 'pending', handledBy: null, handledAt: null, createdAt: new Date() })
      .where(eq(upgradeRequests.userId, session.user.id))
  } else {
    await db.insert(upgradeRequests).values({
      userId: session.user.id,
      message,
      requestedRole,
      status: 'pending',
    })
  }

  revalidatePath('/admin')
  return { success: true }
}

export async function listPendingUpgradeRequests() {
  await requireAdmin()
  return db
    .select({
      id: upgradeRequests.id,
      message: upgradeRequests.message,
      requestedRole: upgradeRequests.requestedRole,
      status: upgradeRequests.status,
      createdAt: upgradeRequests.createdAt,
      userId: upgradeRequests.userId,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      userImage: users.image,
    })
    .from(upgradeRequests)
    .leftJoin(users, eq(users.id, upgradeRequests.userId))
    .where(eq(upgradeRequests.status, 'pending'))
    .orderBy(desc(upgradeRequests.createdAt))
}

export async function dismissUpgradeRequest(id: string) {
  const session = await requireAdmin()
  await db
    .update(upgradeRequests)
    .set({ status: 'dismissed', handledBy: session.user.id, handledAt: new Date() })
    .where(eq(upgradeRequests.id, id))
  revalidatePath('/admin')
  return { success: true }
}

export async function approveUpgradeRequest(
  id: string,
  newRole: 'admin' | 'member' | 'readonly'
) {
  const session = await requireAdmin()

  // Only superusers can promote to admin
  if (newRole === 'admin' && session.user.role !== 'superuser') {
    return { error: 'Only superusers can promote to admin.' }
  }

  const request = await db
    .select({ userId: upgradeRequests.userId })
    .from(upgradeRequests)
    .where(eq(upgradeRequests.id, id))
    .then((r) => r[0])
  if (!request) return { error: 'Request not found.' }
  if (request.userId === session.user.id) return { error: 'Cannot change your own role.' }

  await db.update(users).set({ role: newRole, updatedAt: new Date() }).where(eq(users.id, request.userId))
  await db
    .update(upgradeRequests)
    .set({ status: 'handled', handledBy: session.user.id, handledAt: new Date() })
    .where(eq(upgradeRequests.id, id))

  revalidatePath('/admin')
  return { success: true }
}
