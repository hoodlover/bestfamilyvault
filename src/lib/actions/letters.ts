'use server'

import { put, del } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { letters } from '@/lib/db/schema'
import { isAllowedRecipientSlug } from '@/lib/letters-recipients'
import { encrypt } from '@/lib/crypto'
import { getParentRecipients } from '@/lib/family-config'

async function requireSuperuser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'superuser') throw new Error('Superusers only')
  return session
}

export async function createLetter(formData: FormData) {
  try {
    const session = await requireSuperuser()

    const recipientName = ((formData.get('recipientName') as string) ?? '').trim().toLowerCase()
    const title = (formData.get('title') as string)?.trim()
    const body = ((formData.get('body') as string) ?? '').trim()
    const file = formData.get('file') as File | null

    if (!recipientName || !isAllowedRecipientSlug(recipientName)) {
      return { error: 'Pick a recipient.' }
    }
    if (!title) return { error: 'Title is required.' }

    let fileUrl: string | null = null
    let fileName: string | null = null
    let contentType: string | null = null
    let size: number | null = null

    if (file && file.size > 0) {
      const blob = await put(`letters/${recipientName}/${Date.now()}-${file.name}`, file, {
        access: 'private',
        contentType: file.type,
      })
      fileUrl = blob.url
      fileName = file.name
      contentType = file.type
      size = file.size
    }

    await db.insert(letters).values({
      recipientName,
      title,
      // letter.body is NOT NULL with default '' — store empty string when no
      // input, encrypted ciphertext otherwise.
      body: body === '' ? '' : (encrypt(body) ?? ''),
      fileUrl,
      fileName,
      contentType,
      size,
      createdBy: session.user.id,
    })

    console.log(
      `[${new Date().toISOString()}] letter saved: recipient=${recipientName} title="${title}" by=${session.user.email ?? session.user.id}${fileUrl ? ` file="${fileName}"` : ''}`
    )

    revalidatePath('/letters')
    return { success: true }
  } catch (err) {
    console.error('createLetter error:', err)
    return { error: err instanceof Error ? err.message : 'Failed to save letter.' }
  }
}

interface SaveLetterMetadataInput {
  recipientName: string
  title: string
  body: string
  fileUrl: string
  fileName: string
  contentType: string
  size: number
}

/**
 * Inserts a letter row whose file was already uploaded directly to Vercel
 * Blob from the client. Used by the in-page recorder + large-attachment
 * paths to bypass the 4.5 MB server-action body limit.
 *
 * The upload token route (/api/letters/upload-token) is what actually
 * authorizes the client to write to the blob namespace. This action
 * trusts the URL it's handed because the only way to get a token is to
 * already be a superuser.
 */
export async function saveLetterMetadata(input: SaveLetterMetadataInput) {
  try {
    const session = await requireSuperuser()

    const recipient = input.recipientName.trim().toLowerCase()
    const title = input.title.trim()
    const body = input.body.trim()

    if (!recipient || !isAllowedRecipientSlug(recipient)) {
      return { error: 'Pick a recipient.' }
    }
    if (!title) return { error: 'Title is required.' }
    if (!input.fileUrl) return { error: 'Missing uploaded file URL.' }

    await db.insert(letters).values({
      recipientName: recipient,
      title,
      body: body === '' ? '' : (encrypt(body) ?? ''),
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      createdBy: session.user.id,
    })

    console.log(
      `[${new Date().toISOString()}] letter saved (client-upload): recipient=${recipient} title="${title}" by=${session.user.email ?? session.user.id} file="${input.fileName}" size=${input.size}`
    )

    revalidatePath('/letters')
    return { success: true }
  } catch (err) {
    console.error('saveLetterMetadata error:', err)
    return { error: err instanceof Error ? err.message : 'Failed to save letter.' }
  }
}

export async function deleteLetter(id: string) {
  try {
    const session = await auth()
    if (!session?.user?.id) return { error: 'Unauthorized' }
    const letter = await db.select().from(letters).where(eq(letters.id, id)).then((r) => r[0])
    if (!letter) return { error: 'Letter not found.' }
    // Permissions:
    //   - 'gift' letters (parent → kid): superuser only.
    //   - 'note-to' letters (kid → parent): the AUTHOR can delete their own.
    //     Recipients can also delete (they got it; if they don't want it,
    //     fine). Other family members can never delete.
    const isSuperuser = session.user.role === 'superuser'
    const isAuthor = letter.createdBy === session.user.id
    if (letter.direction === 'gift') {
      if (!isSuperuser) return { error: 'Superusers only.' }
    } else {
      // For note-to letters, also allow the named recipient to delete.
      const parents = getParentRecipients()
      const recipientParent = parents.find((p) => p.slug === letter.recipientName)
      const userEmail = (session.user.email ?? '').toLowerCase()
      const isRecipient = recipientParent?.emails.some((e) => e.toLowerCase() === userEmail) ?? false
      if (!isAuthor && !isRecipient && !isSuperuser) {
        return { error: 'Not your letter to delete.' }
      }
    }
    if (letter.fileUrl) {
      try { await del(letter.fileUrl) } catch { /* blob may already be gone */ }
    }
    await db.delete(letters).where(eq(letters.id, id))
    revalidatePath('/letters')
    return { success: true }
  } catch (err) {
    console.error('deleteLetter error:', err)
    return { error: err instanceof Error ? err.message : 'Delete failed.' }
  }
}

// ─── Kid-to-parent letters ──────────────────────────────────────────────────

interface CreateLetterToParentInput {
  recipientSlug: string         // 'lance' or 'heather' (parent slug)
  title: string
  body: string
  fileUrl?: string | null       // pre-uploaded blob URL (optional)
  fileName?: string | null
  contentType?: string | null
  size?: number | null
  unlockAt?: string | null      // ISO date — when recipient can read
}

/**
 * Create a "note-to" letter — anyone in the family can send. Visibility
 * is restricted to (a) the author and (b) the named parent recipient.
 * Other family members never see these. Even the superuser doesn't
 * bypass — privacy partition.
 */
export async function createLetterToParent(input: CreateLetterToParentInput) {
  try {
    const session = await auth()
    if (!session?.user?.id) return { error: 'Sign in first.' }
    if (session.user.role === 'readonly') return { error: 'Read-only access.' }

    const recipientSlug = input.recipientSlug.trim().toLowerCase()
    const title = input.title.trim()
    const body = input.body.trim()

    const parents = getParentRecipients()
    if (!parents.some((p) => p.slug === recipientSlug)) {
      return { error: 'Recipient is not a parent in family-config.' }
    }
    if (!title) return { error: 'Title is required.' }

    let unlockAt: Date | null = null
    if (input.unlockAt && input.unlockAt.trim()) {
      const d = new Date(input.unlockAt)
      if (Number.isNaN(d.getTime())) return { error: 'Invalid unlock date.' }
      unlockAt = d
    }

    await db.insert(letters).values({
      recipientName: recipientSlug,
      title,
      body: body === '' ? '' : (encrypt(body) ?? ''),
      fileUrl: input.fileUrl ?? null,
      fileName: input.fileName ?? null,
      contentType: input.contentType ?? null,
      size: input.size ?? null,
      direction: 'note-to',
      unlockAt,
      createdBy: session.user.id,
    })

    console.log(
      `[${new Date().toISOString()}] note-to letter saved: recipient=${recipientSlug} title="${title}" by=${session.user.email ?? session.user.id}${unlockAt ? ` unlocks=${unlockAt.toISOString().slice(0, 10)}` : ''}`
    )

    revalidatePath('/letters')
    return { success: true }
  } catch (err) {
    console.error('createLetterToParent error:', err)
    return { error: err instanceof Error ? err.message : 'Failed to save letter.' }
  }
}
