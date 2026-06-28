'use server'

import { put } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, files, categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { titleCaseWords } from '@/lib/title-case'
import { encrypt } from '@/lib/crypto'

// Receipt = a vault entry capturing one or more receipt photos. Single
// receipt: behaves like the original — one entry, one attachment, total +
// merchant on customFields. Batch: one entry, N attachments, summed total
// + per-item detail on customFields.items so a future spending view can
// fan out the line items.

interface ItemMeta {
  merchant: string
  totalCents: number
  purchaseDate: string | null
}

interface CreateReceiptInput {
  title: string
  items: ItemMeta[]
  categoryId: string
  subcategoryId: string | null
  noteContent: string | null
  isPersonal: boolean
}

export async function createReceiptEntry(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const fileEntries = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (fileEntries.length === 0) return { error: 'At least one receipt photo is required.' }
  for (const f of fileEntries) {
    if (f.size > 25 * 1024 * 1024) {
      return { error: `${f.name || 'A receipt photo'} is over 25 MB.` }
    }
  }

  const input = parseInput(formData, fileEntries.length)
  if ('error' in input) return input
  if (input.items.length !== fileEntries.length) {
    return { error: 'Receipt count mismatch — please retry.' }
  }

  const cat = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, input.categoryId))
    .then((r) => r[0])
  if (!cat) return { error: 'Category not found.' }

  const totalCents = input.items.reduce((s, it) => s + it.totalCents, 0)
  const isBatch = input.items.length > 1

  // Earliest item date is a reasonable batch "purchaseDate" for downstream
  // surfaces; falls back to today when nothing has a date.
  const dates = input.items.map((it) => it.purchaseDate).filter((d): d is string => !!d)
  dates.sort()
  const batchDate = dates[0] ?? new Date().toISOString().slice(0, 10)
  const merchantsForDisplay = isBatch
    ? Array.from(new Set(input.items.map((it) => it.merchant))).join(', ').slice(0, 240)
    : input.items[0].merchant

  const customFields: Record<string, string> = {
    kind: 'receipt',
    merchant: merchantsForDisplay,
    totalCents: String(totalCents),
    purchaseDate: batchDate,
    receiptCount: String(input.items.length),
  }
  if (isBatch) {
    // Serialize per-item detail so a future spending view can fan out.
    // customFields is typed Record<string, string>; the consumer JSON.parses.
    customFields.items = JSON.stringify(input.items)
  }

  const [entry] = await db
    .insert(entries)
    .values({
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId,
      type: 'document',
      title: titleCaseWords(input.title),
      noteContent: encrypt(input.noteContent),
      customFields,
      isPersonal: input.isPersonal,
      isPrivate: false,
      isFavorite: false,
      isRecurring: false,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  // Upload each photo. We do them sequentially so a Blob 5xx mid-batch
  // produces a clear partial-success rather than a thundering herd of
  // concurrent uploads. On failure we keep going so the user gets as much
  // as we can save, and report a soft warning.
  let attachedCount = 0
  const failures: string[] = []
  for (let i = 0; i < fileEntries.length; i++) {
    const file = fileEntries[i]
    const itemDate = input.items[i].purchaseDate ?? batchDate
    const ext = extOf(file.name) || mimeExt(file.type) || '.jpg'
    const suffix = isBatch ? `-${i + 1}` : ''
    const displayName = `receipt-${itemDate}${suffix}${ext}`
    try {
      const blob = await put(
        `vault/${session.user.id}/receipts/${Date.now()}-${i}-${displayName}`,
        file,
        { access: 'private', contentType: file.type || 'image/jpeg' },
      )
      await db.insert(files).values({
        entryId: entry.id,
        filename: displayName,
        blobUrl: blob.url,
        contentType: file.type || 'image/jpeg',
        size: file.size,
        isPrivate: false,
        uploadedBy: session.user.id,
      })
      attachedCount++
    } catch (err) {
      console.error('receipt upload failed', err)
      failures.push(displayName)
    }
  }

  revalidatePath('/dashboard')
  revalidatePath(`/categories/${cat.slug}`)
  revalidatePath('/my-vault')

  if (failures.length > 0 && attachedCount === 0) {
    return {
      success: true,
      id: entry.id,
      warning: `Saved the entry, but ${failures.length} photo upload(s) failed. Re-attach on the entry.`,
    }
  }
  if (failures.length > 0) {
    return {
      success: true,
      id: entry.id,
      warning: `Attached ${attachedCount} of ${fileEntries.length} photos — re-attach the rest on the entry.`,
    }
  }
  return { success: true, id: entry.id }
}

function parseInput(formData: FormData, fileCount: number): CreateReceiptInput | { error: string } {
  const title = (formData.get('title') as string | null)?.trim() ?? ''
  if (!title) return { error: 'Give the receipt a name.' }

  const itemsRaw = (formData.get('items') as string | null)?.trim() ?? ''
  if (!itemsRaw) return { error: 'Receipt details missing — please retry.' }
  let items: ItemMeta[]
  try {
    const parsed = JSON.parse(itemsRaw) as unknown
    if (!Array.isArray(parsed)) throw new Error('items must be an array')
    items = parsed.map((raw, i) => {
      const obj = raw as { merchant?: unknown; totalCents?: unknown; purchaseDate?: unknown }
      const merchant = typeof obj.merchant === 'string' ? obj.merchant.trim() : ''
      if (!merchant) throw new Error(`Item ${i + 1}: merchant is required`)
      const total = typeof obj.totalCents === 'number' ? obj.totalCents : Number(obj.totalCents)
      if (!Number.isFinite(total) || total < 0) {
        throw new Error(`Item ${i + 1}: invalid amount`)
      }
      const date =
        typeof obj.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.purchaseDate)
          ? obj.purchaseDate
          : null
      return { merchant, totalCents: Math.round(total), purchaseDate: date }
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid receipt details.' }
  }
  if (items.length === 0) return { error: 'Add at least one receipt.' }
  if (items.length !== fileCount) return { error: 'Receipt count mismatch — please retry.' }

  const categoryId = (formData.get('categoryId') as string | null)?.trim() ?? ''
  if (!categoryId) return { error: 'Pick a category.' }

  const subcategoryId = ((formData.get('subcategoryId') as string | null) ?? '').trim() || null
  const noteContent = ((formData.get('noteContent') as string | null) ?? '').trim() || null
  const isPersonal = formData.get('isPersonal') === 'true'

  return { title, items, categoryId, subcategoryId, noteContent, isPersonal }
}

function extOf(name: string): string {
  const m = name.match(/\.[a-z0-9]{1,8}$/i)
  return m ? m[0].toLowerCase() : ''
}

function mimeExt(type: string): string {
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/gif') return '.gif'
  return ''
}
