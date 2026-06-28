'use server'

import { put, del } from '@vercel/blob'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import exifr from 'exifr'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, files } from '@/lib/db/schema'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

/**
 * Build a clean filename slug from a parent title — lowercase,
 * alphanumeric + dashes only, no leading/trailing dashes. Returns
 * empty string if the title sanitizes down to nothing (e.g. emoji-
 * only titles), so callers fall back to the original filename.
 */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Common camera / scanner prefixes that carry no user-supplied
// meaning. Anything starting with one of these gets treated as
// gibberish even when it slugifies to a long string.
const GIBBERISH_PREFIXES = /^(img|dsc|dcim|mvimg|vid|pxl|scan)[_\-]/i
const SCREENSHOT_PREFIX = /^screenshot/i

/**
 * True when the user's original filename carries no meaningful name —
 * camera dumps (IMG_20250603_123456.jpg), scanner output, screenshots,
 * hex hashes, all-digit names. Also true for stems that slugify to 0–2
 * characters, which aren't useful as a filename component.
 */
function isGibberishName(originalName: string): boolean {
  const stem = originalName.replace(/\.[^.]+$/, '').trim()
  if (!stem) return true
  if (SCREENSHOT_PREFIX.test(stem)) return true
  if (GIBBERISH_PREFIXES.test(stem)) return true
  // Pure digits / hex / UUID-shaped → no info to preserve.
  if (/^[0-9a-f-]+$/i.test(stem) && stem.length >= 10) return true
  if (slugifyTitle(stem).length < 3) return true
  return false
}

function extOf(name: string): string {
  const m = name.match(/\.[a-z0-9]{1,8}$/i)
  return m ? m[0].toLowerCase() : ''
}

function dateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Best-effort capture-date for the file:
 *   - Images → EXIF DateTimeOriginal (when the shutter actually fired),
 *     falling back to CreateDate / ModifyDate. The .heic / .png /
 *     .webp / .jpg / .jpeg / .gif paths all flow through exifr.
 *   - Everything else (video, audio, docs) → null, caller falls back
 *     to upload time.
 *
 * Returns null on any parse failure so we don't block the upload.
 */
async function detectCaptureDate(file: File): Promise<Date | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const meta = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
    const d = meta?.DateTimeOriginal ?? meta?.CreateDate ?? meta?.ModifyDate
    if (!d) return null
    if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d
    if (typeof d === 'string' || typeof d === 'number') {
      const parsed = new Date(d)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * Trim a slug to a max length, dropping any trailing dash if the cut
 * landed mid-segment. Used so the parent-title suffix on auto-named
 * uploads stays short (12 chars by default) and doesn't crowd the
 * unique part of the name in narrow attachment-list rows.
 */
function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug
  return slug.slice(0, max).replace(/-+$/, '')
}

const PARENT_SUFFIX_MAX = 12

/**
 * Derive an auto-name for a new upload.
 *
 *   Meaningful original (user typed a real name like "Sydney DL 2022.jpg"):
 *     → kept verbatim. No slugify, no parent-title suffix, no date
 *     prepend. Lance's feedback: those extra dashes made readable names
 *     hard to scan once they grew into "sydney-dl-2022-sydney-s-id.jpg".
 *     Same-name re-uploads to the same entry still get a "-2 / -3"
 *     counter so the attachment list disambiguates them.
 *
 *   Gibberish original (camera / scanner / screenshot dumps, hex —
 *   IMG_20250603_123456.jpg, Screenshot_2026-06-15.png, hex hashes):
 *     → renamed to "<date>-<parent-suffix>.<ext>", e.g.
 *     "2026-06-03-tax-filings.jpg". Date comes from EXIF when present,
 *     otherwise upload time. Same-day re-uploads get the "-2 / -3"
 *     counter.
 *
 * If the parent has no title we return the original name regardless of
 * the meaningful / gibberish split — there's nothing to attach.
 */
async function deriveAutoFilename(
  originalName: string,
  entryId: string | null,
  noteId: string | null,
  captureDate: Date | null,
): Promise<string> {
  const meaningful = !isGibberishName(originalName)
  const ext = extOf(originalName)
  const stem = originalName.replace(/\.[^.]+$/, '')

  // Meaningful path — preserve the user's name verbatim. We only need
  // the parent lookup for collision-count scoping (so two "Sydney DL
  // 2022.jpg" uploads to the same entry become "...jpg" + "...-2.jpg"),
  // not for renaming.
  if (meaningful) {
    let collisions = 0
    if (noteId || entryId) {
      const existing = await db
        .select({ filename: files.filename })
        .from(files)
        .where(noteId ? eq(files.noteId, noteId) : eq(files.entryId, entryId!))
      for (const f of existing) {
        const fStem = f.filename.replace(/\.[^.]+$/, '')
        if (fStem === stem || fStem.startsWith(`${stem}-`)) collisions++
      }
    }
    const suffix = collisions === 0 ? '' : `-${collisions + 1}`
    return `${stem}${suffix}${ext}`
  }

  // Gibberish path — original name carries no info, so build a
  // synthetic "<date>-<parent-suffix>.<ext>" name.
  let parentTitle: string | null = null
  if (noteId) {
    const row = await db.select({ title: notes.title }).from(notes).where(eq(notes.id, noteId)).then((r) => r[0])
    parentTitle = row?.title ?? null
  } else if (entryId) {
    const row = await db.select({ title: entries.title }).from(entries).where(eq(entries.id, entryId)).then((r) => r[0])
    parentTitle = row?.title ?? null
  }
  if (!parentTitle) return originalName

  const parentSlugFull = slugifyTitle(parentTitle)
  if (!parentSlugFull) return originalName
  const parentSuffix = truncateSlug(parentSlugFull, PARENT_SUFFIX_MAX)

  const leading = dateStr(captureDate ?? new Date())
  const base = `${leading}-${parentSuffix}`

  let collisions = 0
  if (noteId || entryId) {
    const existing = await db
      .select({ filename: files.filename })
      .from(files)
      .where(noteId ? eq(files.noteId, noteId) : eq(files.entryId, entryId!))
    for (const f of existing) {
      if (f.filename.startsWith(base)) collisions++
    }
  }

  const suffix = collisions === 0 ? '' : `-${collisions + 1}`
  return `${base}${suffix}${ext}`
}

export async function uploadFile(formData: FormData) {
  // Per-step diagnostics — when an upload fails we want to know exactly
  // which step blew up (Lance hit a Maverick-truck-only failure where
  // "unexpected error from the server" gave no clue whether it was
  // EXIF parsing, parent-title lookup, blob put, or the DB insert).
  // The step var is included in both the server log AND the user-facing
  // error so the next failure tells us where to look.
  let step = 'init'
  const file = formData.get('file') as File | null
  const entryId = (formData.get('entryId') as string) || null
  const noteId = (formData.get('noteId') as string) || null
  const categoryId = (formData.get('categoryId') as string) || null
  const isPrivate = formData.get('isPrivate') === 'true'
  try {
    step = 'auth'
    const session = await getSession()
    if (session.user.role === 'readonly') return { error: 'Read-only access.' }

    if (!file) return { error: 'No file provided.' }

    // Auto-name based on the parent's title + the file's date so the
    // attachments list stays readable. For photos we read EXIF
    // DateTimeOriginal so the filename reflects WHEN the picture was
    // taken, not when it was uploaded — important for camera-roll
    // backfills. For audio/video/docs we just stamp upload time, which
    // matches the user's mental model (you recorded/saved this today).
    step = 'exif'
    const captureDate = await detectCaptureDate(file)
    step = 'derive-filename'
    const displayName = await deriveAutoFilename(file.name, entryId, noteId, captureDate)

    step = 'blob-put'
    const blob = await put(`vault/${session.user.id}/${Date.now()}-${displayName}`, file, {
      access: 'private',
      contentType: file.type,
    })

    step = 'db-insert'
    const [record] = await db
      .insert(files)
      .values({
        entryId,
        noteId,
        categoryId,
        filename: displayName,
        blobUrl: blob.url,
        contentType: file.type,
        size: file.size,
        isPrivate,
        uploadedBy: session.user.id,
      })
      .returning()

    console.log(
      `[${new Date().toISOString()}] file uploaded: name="${displayName}" (orig="${file.name}") size=${file.size} type=${file.type} by=${session.user.email ?? session.user.id}${entryId ? ` entryId=${entryId}` : ''}${noteId ? ` noteId=${noteId}` : ''}${categoryId ? ` categoryId=${categoryId}` : ''}`
    )

    // Revalidate the entry detail page too — without this, the user has
    // to hard-refresh to see the new attachment land. Previously only
    // /dashboard was revalidated.
    revalidatePath('/dashboard')
    if (entryId) revalidatePath(`/entries/${entryId}`)
    if (noteId) revalidatePath(`/notes/${noteId}`)
    return { success: true, file: record }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err)
    console.error(
      `[uploadFile] step="${step}" entryId=${entryId} noteId=${noteId} fileName="${file?.name ?? '<none>'}" size=${file?.size ?? 0} type=${file?.type ?? '<none>'} err:`,
      err,
    )
    // Include the step name so a user-reported failure is debuggable
    // without server log access. Trim very long messages to keep the
    // toast readable.
    const short = rawMsg.length > 200 ? `${rawMsg.slice(0, 200)}…` : rawMsg
    return { error: `Upload failed at "${step}": ${short}` }
  }
}

/**
 * Rename an existing file's display name (the one shown in the
 * attachment list + used on download). Doesn't touch the underlying
 * blob URL — only the `files.filename` column. Trims, enforces a
 * sensible length, preserves the original extension if the user
 * forgets one.
 */
export async function renameFile(id: string, newName: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const file = await db.select().from(files).where(eq(files.id, id)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }
  if (file.isPrivate && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  const trimmed = newName.trim().slice(0, 200)
  if (!trimmed) return { error: 'Name cannot be empty.' }

  // Preserve the original extension if the user removed it.
  const origExt = extOf(file.filename)
  const newExt = extOf(trimmed)
  const finalName = newExt || !origExt ? trimmed : `${trimmed}${origExt}`

  await db.update(files).set({ filename: finalName }).where(eq(files.id, id))
  revalidatePath('/dashboard')
  return { success: true, filename: finalName }
}

// Rotate an image file's display orientation by 90 degrees clockwise.
// Cycles 0 → 90 → 180 → 270 → 0. The raw bytes stay on disk; the
// /api/files/[id] route applies the rotation via sharp on serve.
export async function rotateFile(id: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const file = await db.select().from(files).where(eq(files.id, id)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }
  if (file.isPrivate && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }
  if (!file.contentType.startsWith('image/')) {
    return { error: 'Only images can be rotated.' }
  }

  const next = ((file.rotation ?? 0) + 90) % 360
  await db.update(files).set({ rotation: next }).where(eq(files.id, id))
  revalidatePath('/dashboard')
  revalidatePath('/cards')
  return { success: true, rotation: next }
}

export async function deleteFile(id: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const file = await db.select().from(files).where(eq(files.id, id)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }

  if (file.isPrivate && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  await del(file.blobUrl)
  await db.delete(files).where(eq(files.id, id))

  revalidatePath('/dashboard')
  return { success: true }
}
