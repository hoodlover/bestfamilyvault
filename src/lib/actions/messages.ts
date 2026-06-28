'use server'

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { put, del } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { messages, users } from '@/lib/db/schema'
import { alias } from 'drizzle-orm/pg-core'
import { encrypt, decrypt } from '@/lib/crypto'
import { sendMessageNotificationEmail } from '@/lib/email'

const MAX_BODY = 2000
const MAX_AUDIO_BYTES = 4 * 1024 * 1024  // 4 MB — same cap as profile voice memos.

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

export async function sendMessage(formData: FormData) {
  const session = await requireUser()
  const toUserId = (formData.get('toUserId') as string)?.trim()
  const body = ((formData.get('body') as string) ?? '').trim().slice(0, MAX_BODY)
  const audio = formData.get('audio')
  const audioFile = audio instanceof File && audio.size > 0 ? audio : null
  const durationRaw = (formData.get('audioDurationSec') as string) ?? ''
  const audioDurationSec = audioFile && durationRaw
    ? Math.max(1, Math.min(60, Math.round(Number(durationRaw))))
    : null

  if (!toUserId) return { error: 'Recipient missing.' }
  if (!body && !audioFile) return { error: 'Message can\'t be empty.' }
  if (toUserId === session.user.id) return { error: 'You can\'t message yourself.' }
  if (audioFile && audioFile.size > MAX_AUDIO_BYTES) {
    return { error: `Recording is too big (${(audioFile.size / 1024 / 1024).toFixed(1)} MB). Keep it short.` }
  }

  const recipient = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, toUserId))
    .then((r) => r[0])
  if (!recipient) return { error: 'Recipient not found.' }

  const senderName = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, session.user.id))
    .then((r) => r[0]?.name ?? r[0]?.email ?? 'A family member')

  let voiceMemoBlobUrl: string | null = null
  let voiceMemoContentType: string | null = null
  if (audioFile) {
    const ext = audioFile.type.includes('webm') ? 'webm'
      : audioFile.type.includes('mp4') ? 'm4a'
      : audioFile.type.includes('ogg') ? 'ogg'
      : 'audio'
    const blobPath = `message-audio/${toUserId}/${Date.now()}-${session.user.id}.${ext}`
    const uploaded = await put(blobPath, audioFile, {
      access: 'private',
      contentType: audioFile.type || 'audio/webm',
      allowOverwrite: true,
    })
    voiceMemoBlobUrl = uploaded.url
    voiceMemoContentType = audioFile.type || 'audio/webm'
  }

  await db.insert(messages).values({
    fromUserId: session.user.id,
    toUserId,
    body: body ? (encrypt(body) ?? body) : null,
    voiceMemoBlobUrl,
    voiceMemoContentType,
    voiceMemoDurationSec: audioDurationSec,
  })

  // Email notification — best-effort. A mail failure must not undo the
  // saved message, so we swallow errors. SMTP env may be missing in dev.
  if (recipient.email) {
    try {
      const firstName = (recipient.name ?? recipient.email).split(/\s+/)[0]
      await sendMessageNotificationEmail({
        to: recipient.email,
        firstName,
        senderName: typeof senderName === 'string' ? senderName : 'A family member',
        bodyPreview: body || null,
        hasVoiceMemo: !!audioFile,
        messagesUrl: `${getAppUrl().replace(/\/$/, '')}/messages`,
      })
    } catch (err) {
      console.warn(
        '[messages] notification email failed — message still saved.',
        err instanceof Error ? err.message : err,
      )
    }
  }

  revalidatePath('/messages')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function getUnreadCount() {
  const session = await auth()
  if (!session?.user?.id) return 0
  const result = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(messages)
    .where(and(eq(messages.toUserId, session.user.id), isNull(messages.readAt)))
  return result[0]?.count ?? 0
}

export async function listInbox() {
  const session = await requireUser()
  const sender = alias(users, 'sender')
  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      voiceMemoBlobUrl: messages.voiceMemoBlobUrl,
      voiceMemoContentType: messages.voiceMemoContentType,
      voiceMemoDurationSec: messages.voiceMemoDurationSec,
      readAt: messages.readAt,
      createdAt: messages.createdAt,
      fromUserId: messages.fromUserId,
      fromName: sender.name,
      fromEmail: sender.email,
      fromImage: sender.image,
    })
    .from(messages)
    .leftJoin(sender, eq(sender.id, messages.fromUserId))
    .where(eq(messages.toUserId, session.user.id))
    .orderBy(desc(messages.createdAt))
    .limit(200)
  return rows.map((m) => ({ ...m, body: m.body ? (decrypt(m.body) ?? m.body) : null }))
}

export async function listSent() {
  const session = await requireUser()
  const recipient = alias(users, 'recipient')
  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      voiceMemoBlobUrl: messages.voiceMemoBlobUrl,
      voiceMemoContentType: messages.voiceMemoContentType,
      voiceMemoDurationSec: messages.voiceMemoDurationSec,
      createdAt: messages.createdAt,
      toUserId: messages.toUserId,
      toName: recipient.name,
      toEmail: recipient.email,
      toImage: recipient.image,
    })
    .from(messages)
    .leftJoin(recipient, eq(recipient.id, messages.toUserId))
    .where(eq(messages.fromUserId, session.user.id))
    .orderBy(desc(messages.createdAt))
    .limit(100)
  return rows.map((m) => ({ ...m, body: m.body ? (decrypt(m.body) ?? m.body) : null }))
}

export async function markMessageRead(id: string) {
  const session = await requireUser()
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.id, id), eq(messages.toUserId, session.user.id), isNull(messages.readAt)))
  revalidatePath('/messages')
  revalidatePath('/dashboard')
  return { success: true }
}

// Returns void so it can be used directly as a `<form action={...}>` server
// action without a wrapper (Next 16 expects void | Promise<void>).
export async function markAllMessagesRead(): Promise<void> {
  const session = await requireUser()
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.toUserId, session.user.id), isNull(messages.readAt)))
  revalidatePath('/messages')
  revalidatePath('/dashboard')
}

export async function deleteMessage(id: string) {
  const session = await requireUser()
  // Sender can delete their own outgoing message; recipient can delete from their inbox.
  const msg = await db
    .select({
      fromUserId: messages.fromUserId,
      toUserId: messages.toUserId,
      voiceMemoBlobUrl: messages.voiceMemoBlobUrl,
    })
    .from(messages)
    .where(eq(messages.id, id))
    .then((r) => r[0])
  if (!msg) return { error: 'Message not found.' }
  if (msg.fromUserId !== session.user.id && msg.toUserId !== session.user.id) {
    return { error: 'Forbidden.' }
  }
  if (msg.voiceMemoBlobUrl) {
    try { await del(msg.voiceMemoBlobUrl) } catch { /* leak a few KB rather than block delete */ }
  }
  await db.delete(messages).where(eq(messages.id, id))
  revalidatePath('/messages')
  revalidatePath('/dashboard')
  return { success: true }
}
