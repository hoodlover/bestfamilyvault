'use server'

import { put, del } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

const MAX_BYTES = 4 * 1024 * 1024  // 4 MB. Most ~30s WebM clips land under 1 MB.

async function requireSuperuser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'superuser') throw new Error('Forbidden')
  return session
}

export async function uploadVoiceMemo(formData: FormData) {
  const session = await requireSuperuser()
  const targetUserId = (formData.get('userId') as string ?? '').trim()
  const blob = formData.get('audio') as File | null

  if (!targetUserId) return { error: 'Missing target user.' }
  if (!blob || !(blob instanceof File) || blob.size === 0) return { error: 'No audio recording.' }
  if (blob.size > MAX_BYTES) {
    return { error: `Recording is too big (${(blob.size / 1024 / 1024).toFixed(1)} MB). Keep it short.` }
  }

  const target = await db.select().from(users).where(eq(users.id, targetUserId)).then((r) => r[0])
  if (!target) return { error: 'Target user not found.' }

  // If there's an existing memo, delete the old blob so we don't pile up
  // unused audio in storage. Best-effort — the DB update is the real source
  // of truth, so a delete failure here just leaks a few KB.
  if (target.voiceMemoBlobUrl) {
    try { await del(target.voiceMemoBlobUrl) } catch { /* ignore */ }
  }

  // Path: voice-memos/{recipientUserId}/{timestamp}.{ext}
  const ext = blob.type.includes('webm') ? 'webm'
    : blob.type.includes('mp4') ? 'm4a'
    : blob.type.includes('ogg') ? 'ogg'
    : 'audio'
  const blobPath = `voice-memos/${targetUserId}/${Date.now()}.${ext}`
  const uploaded = await put(blobPath, blob, {
    access: 'private',
    contentType: blob.type || 'audio/webm',
    allowOverwrite: true,
  })

  await db.update(users).set({
    voiceMemoBlobUrl: uploaded.url,
    voiceMemoContentType: blob.type || 'audio/webm',
    updatedAt: new Date(),
  }).where(eq(users.id, targetUserId))

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true, recordedBy: session.user.id }
}

export async function removeVoiceMemo(targetUserId: string) {
  await requireSuperuser()
  const target = await db.select().from(users).where(eq(users.id, targetUserId)).then((r) => r[0])
  if (!target) return { error: 'Target user not found.' }

  if (target.voiceMemoBlobUrl) {
    try { await del(target.voiceMemoBlobUrl) } catch { /* ignore */ }
  }
  await db.update(users).set({
    voiceMemoBlobUrl: null,
    voiceMemoContentType: null,
    updatedAt: new Date(),
  }).where(eq(users.id, targetUserId))

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true }
}
