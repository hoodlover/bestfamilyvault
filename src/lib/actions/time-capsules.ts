'use server'

import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { timeCapsules, users } from '@/lib/db/schema'
import { encrypt, decrypt } from '@/lib/crypto'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

const MIN_UNLOCK_OFFSET_MS = 60 * 60 * 1000 // 1 hour minimum — capsules aren't messages
const MAX_BODY_LENGTH = 50_000
const MAX_TITLE_LENGTH = 200

export async function createCapsule(formData: FormData) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const title = (formData.get('title') as string ?? '').trim()
  const body = (formData.get('body') as string ?? '').trim()
  const toUserIdRaw = (formData.get('toUserId') as string ?? '').trim()
  const unlockAtRaw = (formData.get('unlockAt') as string ?? '').trim()

  if (!title) return { error: 'Title is required.' }
  if (title.length > MAX_TITLE_LENGTH) return { error: 'Title is too long.' }
  if (body.length > MAX_BODY_LENGTH) return { error: 'Body is too long (50K chars max).' }
  if (!unlockAtRaw) return { error: 'Pick an unlock date.' }

  const unlockAt = new Date(unlockAtRaw)
  if (Number.isNaN(unlockAt.getTime())) return { error: 'That unlock date doesn’t parse.' }
  if (unlockAt.getTime() < Date.now() + MIN_UNLOCK_OFFSET_MS) {
    return { error: 'Unlock date must be at least an hour in the future.' }
  }

  // toUserId === '' or 'all' → null (addressed to whole family)
  const toUserId =
    toUserIdRaw && toUserIdRaw !== 'all'
      ? toUserIdRaw
      : null

  // Validate the recipient exists if specified.
  if (toUserId) {
    const exists = await db.select({ id: users.id }).from(users).where(eq(users.id, toUserId)).then((r) => r[0])
    if (!exists) return { error: 'Recipient not found.' }
  }

  await db.insert(timeCapsules).values({
    fromUserId: session.user.id,
    toUserId,
    title,
    body: body === '' ? '' : (encrypt(body) ?? ''),
    unlockAt,
  })

  revalidatePath('/capsules')
  return { success: true }
}

export interface CapsuleListItem {
  id: string
  fromUserId: string
  fromName: string | null
  toUserId: string | null
  toName: string | null   // 'All family' if toUserId is null
  title: string
  unlockAt: string        // ISO
  firstReadAt: string | null
  createdAt: string
  isMine: boolean         // I sent it
  isForMe: boolean        // I'm a recipient
  isUnlocked: boolean
}

export async function listCapsules(): Promise<CapsuleListItem[]> {
  const session = await getSession()
  const userId = session.user.id

  // Anything I sent OR addressed to me OR addressed to all family.
  const rows = await db
    .select()
    .from(timeCapsules)
    .where(
      or(
        eq(timeCapsules.fromUserId, userId),
        eq(timeCapsules.toUserId, userId),
        isNull(timeCapsules.toUserId)
      )
    )
    .orderBy(desc(timeCapsules.unlockAt))

  // Resolve user names for the cards. Cheap join on the user table.
  const userIds = new Set<string>()
  for (const r of rows) {
    userIds.add(r.fromUserId)
    if (r.toUserId) userIds.add(r.toUserId)
  }
  const userRows = userIds.size
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    : []
  const userById = new Map(userRows.map((u) => [u.id, u]))

  const now = Date.now()
  return rows.map((r) => {
    const isMine = r.fromUserId === userId
    const isForMe = r.toUserId === userId || r.toUserId === null
    const isUnlocked = r.unlockAt.getTime() <= now
    const fromUser = userById.get(r.fromUserId)
    const toUser = r.toUserId ? userById.get(r.toUserId) : null
    return {
      id: r.id,
      fromUserId: r.fromUserId,
      fromName: fromUser?.name ?? fromUser?.email ?? null,
      toUserId: r.toUserId,
      toName: r.toUserId ? (toUser?.name ?? toUser?.email ?? null) : 'All family',
      title: r.title,
      unlockAt: r.unlockAt.toISOString(),
      firstReadAt: r.firstReadAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      isMine,
      isForMe,
      isUnlocked,
    }
  })
}

export interface CapsuleViewResult {
  id: string
  title: string
  body: string             // plaintext after decrypt; '' if still sealed
  fromName: string | null
  toName: string | null
  unlockAt: string
  isUnlocked: boolean
  isMine: boolean
}

export async function viewCapsule(id: string): Promise<CapsuleViewResult | { error: string }> {
  const session = await getSession()
  const userId = session.user.id

  const row = await db.select().from(timeCapsules).where(eq(timeCapsules.id, id)).then((r) => r[0])
  if (!row) return { error: 'Capsule not found.' }

  const isMine = row.fromUserId === userId
  const isForMe = row.toUserId === userId || row.toUserId === null
  if (!isMine && !isForMe) return { error: 'Not yours to read.' }

  const isUnlocked = row.unlockAt.getTime() <= Date.now()

  // Sender can always see metadata, but body stays sealed even from them
  // until the unlock date — that's the whole point of writing one.
  const body = isUnlocked ? (decrypt(row.body) ?? '') : ''

  // First-read tracking: only count when a recipient (not the sender)
  // opens it after unlock.
  if (isUnlocked && !isMine && isForMe && !row.firstReadAt) {
    await db.update(timeCapsules).set({ firstReadAt: new Date() }).where(eq(timeCapsules.id, id))
  }

  // Look up names for the view.
  const userIds = new Set([row.fromUserId, ...(row.toUserId ? [row.toUserId] : [])])
  const userRows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users)
  const userById = new Map(userRows.map((u) => [u.id, u]))
  const fromUser = userById.get(row.fromUserId)
  const toUser = row.toUserId ? userById.get(row.toUserId) : null

  return {
    id: row.id,
    title: row.title,
    body,
    fromName: fromUser?.name ?? fromUser?.email ?? null,
    toName: row.toUserId ? (toUser?.name ?? toUser?.email ?? null) : 'All family',
    unlockAt: row.unlockAt.toISOString(),
    isUnlocked,
    isMine,
  }
}

export async function cancelCapsule(id: string) {
  const session = await getSession()

  const row = await db.select().from(timeCapsules).where(eq(timeCapsules.id, id)).then((r) => r[0])
  if (!row) return { error: 'Capsule not found.' }
  if (row.fromUserId !== session.user.id) return { error: 'Only the sender can cancel.' }
  if (row.unlockAt.getTime() <= Date.now()) {
    return { error: 'Already unlocked — too late to cancel.' }
  }

  await db.delete(timeCapsules).where(eq(timeCapsules.id, id))
  revalidatePath('/capsules')
  return { success: true }
}
