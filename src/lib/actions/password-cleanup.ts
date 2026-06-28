'use server'

// Bulk delete login entries from /admin/password-cleanup. Builds a CSV
// snapshot of what's about to be deleted BEFORE deleting so the user
// has a one-shot recovery handle for the current session. Returns the
// CSV in the action result; the client offers it as a downloaded file.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { decryptEntries, encrypt } from '@/lib/crypto'
import { revalidatePath } from 'next/cache'

function csvCell(value: string | null | undefined): string {
  const s = value ?? ''
  // Always quote — keeps things consistent and saves us from worrying
  // about commas/newlines inside fields. Double any quote inside the value.
  return `"${s.replace(/"/g, '""')}"`
}

export async function bulkDeleteLogins(
  ids: string[],
  options?: { includeCsv?: boolean },
): Promise<{
  ok?: boolean
  deleted?: number
  csv?: string
  filename?: string
  error?: string
}> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    return { error: 'Admin only.' }
  }
  if (ids.length === 0) return { error: 'No entries selected.' }

  // Pull every selected entry — only login types, only ones the caller
  // can see. inArray + per-row visibility filtering prevents a sneaky
  // payload from deleting someone else's personal entries.
  const rows = await db.select().from(entries).where(inArray(entries.id, ids))
  const decrypted = decryptEntries(rows)

  const allowed = decrypted.filter((e) => {
    if (e.type !== 'login') return false
    if (e.isPrivate && session.user.role !== 'superuser') return false
    if (e.isPersonal && e.createdBy !== session.user.id) return false
    return true
  })

  if (allowed.length === 0) return { error: 'No deletable login entries in selection.' }

  // Category lookup so the CSV records where each entry lived.
  const catIds = Array.from(new Set(allowed.map((e) => e.categoryId)))
  const cats = catIds.length
    ? await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, catIds))
    : []
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  // CSV snapshot is opt-in. Default is "don't generate" — Lance complained
  // about being buried in Excel files during cleanup sweeps where he's
  // intentionally deleting dozens of stale logins. Neon has PITR; we
  // don't need a local CSV to feel safe. Per-action checkbox in the UI
  // brings it back when he wants the belt-and-suspenders.
  const stamp = new Date().toISOString()
  let csv: string | undefined
  if (options?.includeCsv) {
    const header = ['id', 'title', 'username', 'password', 'url', 'category', 'deleted_at']
    const lines: string[] = [header.join(',')]
    for (const e of allowed) {
      lines.push([
        csvCell(e.id),
        csvCell(e.title),
        csvCell(e.username),
        csvCell(e.password),
        csvCell(e.url),
        csvCell(catName.get(e.categoryId) ?? ''),
        csvCell(stamp),
      ].join(','))
    }
    csv = lines.join('\r\n') + '\r\n'
  }

  // Detach children before deleting (same as deleteEntry). Then delete
  // in a single statement.
  const allowedIds = allowed.map((e) => e.id)
  await db.update(entries).set({ parentEntryId: null }).where(inArray(entries.parentEntryId, allowedIds))
  await db.delete(entries).where(inArray(entries.id, allowedIds))

  revalidatePath('/dashboard')
  revalidatePath('/admin/password-cleanup')
  revalidatePath('/search')

  // Filename only emitted alongside the CSV.
  const filename = csv ? `password-cleanup-${stamp.replace(/[:.]/g, '-')}-${allowed.length}.csv` : undefined

  return { ok: true, deleted: allowed.length, csv, filename }
}

// ─── Merge ────────────────────────────────────────────────────────────────
//
// Combine 2+ login entries into one. The "keeper" gets patched with the
// user's chosen field values; the rest get CSV-snapshotted and deleted.
// Same per-entry visibility filtering as bulk delete.

interface MergeFields {
  title?: string
  username?: string | null
  password?: string | null
  url?: string | null
  categoryId?: string
}

export async function mergeAndDeleteLogins(params: {
  keeperId: string
  merged: MergeFields
  deleteIds: string[]
  /** When true, append every non-keeper's username / password / url to
   *  the keeper's noteContent before deletion, so the user can try the
   *  other passwords if the picked one turns out to be wrong. */
  preserveInNotes?: boolean
  /** Opt-in CSV snapshot of the deleted rows. Defaults off — the
   *  preserveInNotes flag already captures the values we care about,
   *  and Lance was drowning in Excel files. */
  includeCsv?: boolean
}): Promise<{
  ok?: boolean
  merged?: { id: string; title: string }
  deleted?: number
  csv?: string
  filename?: string
  error?: string
}> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    return { error: 'Admin only.' }
  }
  if (!params.keeperId) return { error: 'No keeper selected.' }
  if (params.deleteIds.length === 0) return { error: 'No other entries to merge in.' }
  if (params.deleteIds.includes(params.keeperId)) {
    return { error: 'Keeper cannot also be in the delete list.' }
  }

  // Pull keeper + delete candidates in one round-trip.
  const allIds = [params.keeperId, ...params.deleteIds]
  const rows = await db.select().from(entries).where(inArray(entries.id, allIds))
  const decrypted = decryptEntries(rows)

  const keeper = decrypted.find((e) => e.id === params.keeperId)
  if (!keeper) return { error: 'Keeper not found.' }
  if (keeper.type !== 'login') return { error: 'Keeper is not a login entry.' }

  // Per-entry visibility filter on EVERY row (keeper + deletes). Bail if
  // the caller can't actually touch any of them. Prevents a hand-crafted
  // request from deleting someone else's private entries through the
  // merge endpoint.
  const allow = (e: typeof keeper) => {
    if (e.isPrivate && session.user.role !== 'superuser') return false
    if (e.isPersonal && e.createdBy !== session.user.id) return false
    return true
  }
  if (!allow(keeper)) return { error: 'No access to keeper entry.' }
  const allowedDeletes = decrypted.filter(
    (e) => params.deleteIds.includes(e.id) && e.type === 'login' && allow(e),
  )
  if (allowedDeletes.length === 0) return { error: 'No deletable login entries in selection.' }

  // CSV snapshot is opt-in here too (same reasoning as bulkDelete).
  const stamp = new Date().toISOString()
  let csv: string | undefined
  if (params.includeCsv) {
    const catIds = Array.from(new Set(allowedDeletes.map((e) => e.categoryId)))
    const cats = catIds.length
      ? await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, catIds))
      : []
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    const header = ['id', 'title', 'username', 'password', 'url', 'category', 'deleted_at', 'merged_into']
    const lines: string[] = [header.join(',')]
    for (const e of allowedDeletes) {
      lines.push([
        csvCell(e.id),
        csvCell(e.title),
        csvCell(e.username),
        csvCell(e.password),
        csvCell(e.url),
        csvCell(catName.get(e.categoryId) ?? ''),
        csvCell(stamp),
        csvCell(params.keeperId),
      ].join(','))
    }
    csv = lines.join('\r\n') + '\r\n'
  }

  // Patch the keeper. Password is encrypted at rest; only re-encrypt if
  // the merged value actually differs from what's stored, so we don't
  // burn cycles or rotate the ciphertext IV when nothing changed.
  const patch: Record<string, string | null> = {}
  if (params.merged.title !== undefined && params.merged.title !== keeper.title) {
    patch.title = params.merged.title
  }
  if (params.merged.username !== undefined && params.merged.username !== keeper.username) {
    patch.username = params.merged.username
  }
  if (params.merged.url !== undefined && params.merged.url !== keeper.url) {
    patch.url = params.merged.url
  }
  if (params.merged.password !== undefined && params.merged.password !== keeper.password) {
    // password column stores ciphertext; encrypt before writing. Empty
    // string clears the field.
    patch.password = params.merged.password === null || params.merged.password === '' ? null : (encrypt(params.merged.password) ?? '')
  }
  if (params.merged.categoryId !== undefined && params.merged.categoryId !== keeper.categoryId) {
    patch.categoryId = params.merged.categoryId
  }

  // Optional "preserve other values to notes" mode. Use case: the user
  // is sure these are the same login conceptually, but they don't know
  // which password is current. Front-and-center keeps one credential
  // set; the rest land in the notes so they can still try the others.
  // Only writes anything when there are real non-matching values to
  // preserve, so toggling the checkbox on a clean merge is a no-op.
  if (params.preserveInNotes) {
    const winningUser = params.merged.username ?? keeper.username ?? ''
    const winningPass = params.merged.password ?? keeper.password ?? ''
    const winningUrl = params.merged.url ?? keeper.url ?? ''

    const otherUsers = Array.from(new Set(
      allowedDeletes.map((e) => (e.username ?? '').trim()).filter((v) => v && v !== winningUser),
    ))
    const otherPasses = Array.from(new Set(
      allowedDeletes.map((e) => (e.password ?? '').trim()).filter((v) => v && v !== winningPass),
    ))
    const otherUrls = Array.from(new Set(
      allowedDeletes.map((e) => (e.url ?? '').trim()).filter((v) => v && v !== winningUrl),
    ))

    if (otherUsers.length || otherPasses.length || otherUrls.length) {
      const today = stamp.slice(0, 10)
      const lines = [`--- Other values from merge on ${today} (try if main fails) ---`]
      if (otherUsers.length) lines.push(`Other usernames: ${otherUsers.join(' | ')}`)
      if (otherPasses.length) lines.push(`Other passwords: ${otherPasses.join(' | ')}`)
      if (otherUrls.length) lines.push(`Other URLs: ${otherUrls.join(' | ')}`)
      const appendage = '\n\n' + lines.join('\n')

      // noteContent is encrypted-at-rest; decryptEntries already gave us
      // the plaintext on keeper, so concat then re-encrypt.
      const newNotes = (keeper.noteContent ?? '') + appendage
      patch.noteContent = encrypt(newNotes) ?? ''
    }
  }

  if (Object.keys(patch).length > 0) {
    await db.update(entries).set(patch).where(eq(entries.id, params.keeperId))
  }

  // Detach children of the soon-to-be-deleted entries, then delete them.
  const deleteIds = allowedDeletes.map((e) => e.id)
  await db.update(entries).set({ parentEntryId: null }).where(inArray(entries.parentEntryId, deleteIds))
  await db.delete(entries).where(inArray(entries.id, deleteIds))

  revalidatePath('/dashboard')
  revalidatePath('/admin/password-cleanup')
  revalidatePath('/search')
  revalidatePath(`/entries/${params.keeperId}`)

  const filename = csv ? `password-merge-${stamp.replace(/[:.]/g, '-')}-${allowedDeletes.length}.csv` : undefined
  return {
    ok: true,
    merged: { id: keeper.id, title: params.merged.title ?? keeper.title },
    deleted: allowedDeletes.length,
    csv,
    filename,
  }
}

// ─── Inline edit ──────────────────────────────────────────────────────────
//
// Tiny patch action so Lance can fix typos / change a URL / rotate a
// password right from the cleanup list without bouncing through
// /entries/{id}/edit. Limited to the four fields the cleanup table
// shows. Anything else still goes through the full edit form.

interface InlineEditFields {
  title?: string
  username?: string | null
  password?: string | null
  url?: string | null
}

export async function updateLoginFields(
  id: string,
  fields: InlineEditFields,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const row = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!row) return { error: 'Entry not found.' }
  if (row.type !== 'login') return { error: 'Inline edit is login-only here.' }
  if (row.isPrivate && session.user.role !== 'superuser') return { error: 'Access denied.' }
  if (row.isPersonal && row.createdBy !== session.user.id) return { error: 'Access denied.' }

  // Build the patch. Title can't be cleared (notNull column); the other
  // three can be set to null by passing '' from the client.
  const patch: Record<string, string | null> = {}
  if (fields.title !== undefined) {
    const trimmed = fields.title.trim()
    if (!trimmed) return { error: 'Title is required.' }
    patch.title = trimmed
  }
  if (fields.username !== undefined) {
    const v = fields.username?.trim() ?? ''
    patch.username = v === '' ? null : v
  }
  if (fields.url !== undefined) {
    const v = fields.url?.trim() ?? ''
    patch.url = v === '' ? null : v
  }
  if (fields.password !== undefined) {
    const v = fields.password ?? ''
    // Password column is encrypted-at-rest. Empty → null; non-empty →
    // encrypt before writing. Re-encrypting on every save is fine; the
    // IV is freshly generated each time so there's no ciphertext-reuse
    // concern.
    patch.password = v === '' ? null : (encrypt(v) ?? '')
  }

  if (Object.keys(patch).length === 0) return { ok: true } // nothing to do

  await db.update(entries).set(patch).where(eq(entries.id, id))

  revalidatePath('/admin/password-cleanup')
  revalidatePath('/dashboard')
  revalidatePath('/search')
  revalidatePath(`/entries/${id}`)

  return { ok: true }
}
