'use server'

// Inbox actions — file-routing operations for the "drop folder" at
// /inbox. Drop-folder files are rows in `files` with entryId, noteId,
// AND categoryId all NULL; everything here either reassigns one of
// those three FKs to move the file out of the inbox, or deletes the
// file outright.

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { del } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { files } from '@/lib/db/schema'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

/**
 * Move an inbox file onto an existing entry. The file leaves the inbox
 * the moment its entryId column gets set — the inbox list filters on
 * `entryId IS NULL AND noteId IS NULL AND categoryId IS NULL`.
 */
export async function attachInboxFileToEntry(fileId: string, entryId: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }
  if (!fileId || !entryId) return { error: 'Missing fileId or entryId.' }

  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }
  if (file.uploadedBy !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  await db
    .update(files)
    .set({ entryId, noteId: null, categoryId: null })
    .where(eq(files.id, fileId))

  revalidatePath('/inbox')
  revalidatePath(`/entries/${entryId}`)
  return { success: true }
}

/** Same as attachInboxFileToEntry but routes to a note instead. */
export async function attachInboxFileToNote(fileId: string, noteId: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }
  if (!fileId || !noteId) return { error: 'Missing fileId or noteId.' }

  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }
  if (file.uploadedBy !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  await db
    .update(files)
    .set({ entryId: null, noteId, categoryId: null })
    .where(eq(files.id, fileId))

  revalidatePath('/inbox')
  revalidatePath(`/notes/${noteId}`)
  return { success: true }
}

/**
 * Delete an inbox file. Drops the blob from Vercel Blob storage and the
 * row from the files table. Owner / superuser only.
 */
export async function deleteInboxFile(fileId: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }
  if (!fileId) return { error: 'Missing fileId.' }

  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }
  if (file.uploadedBy !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }
  // Sanity: only delete via this action if it's still actually orphaned.
  // Prevents an accidental "delete inbox file" call from removing a
  // file that's already attached to an entry.
  if (file.entryId || file.noteId || file.categoryId) {
    return { error: 'File is no longer in the inbox.' }
  }

  try {
    await del(file.blobUrl)
  } catch (err) {
    console.warn('[inbox] blob delete failed (continuing with DB row delete):', err)
  }
  await db.delete(files).where(eq(files.id, fileId))

  revalidatePath('/inbox')
  return { success: true }
}

/** Stable count helper — used by the sidebar badge so Lance can see at
 *  a glance whether there's anything waiting in the drop folder.
 *  Soft-fails to 0 on any error so a count-query problem doesn't kill
 *  the chrome. Per-user (uploadedBy) so the badge is meaningful even
 *  on shared vaults. */
export async function getMyInboxCount(): Promise<number> {
  try {
    const session = await auth()
    if (!session?.user?.id) return 0
    const rows = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.uploadedBy, session.user.id),
          isNull(files.entryId),
          isNull(files.noteId),
          isNull(files.categoryId),
        ),
      )
    return rows.length
  } catch {
    return 0
  }
}
