'use server'

import { put, del } from '@vercel/blob'
import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, invites, categories, subcategories, files, notes, entries } from '@/lib/db/schema'

type InviteRole = 'admin' | 'member' | 'readonly'
const VALID_ROLES: readonly InviteRole[] = ['admin', 'member', 'readonly']

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return session
}

async function requireSuperuser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'superuser') throw new Error('Forbidden')
  return session
}

export async function sendInvite(formData: FormData) {
  const session = await requireAdmin()
  const email = formData.get('email') as string
  const role = formData.get('role') as string

  if (!email) return { error: 'Email is required.' }
  if (!VALID_ROLES.includes(role as InviteRole)) return { error: 'Invalid role.' }

  if (role === 'admin' && session.user.role !== 'superuser') {
    return { error: 'Only superusers can invite admins.' }
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db.insert(invites).values({
    email,
    token,
    role: role as InviteRole,
    invitedBy: session.user.id,
    expiresAt,
  })

  revalidatePath('/admin')
  return { success: true, token, inviteUrl: `/register?token=${token}` }
}

export async function revokeInvite(id: string) {
  await requireAdmin()
  await db.update(invites).set({ status: 'expired' }).where(eq(invites.id, id))
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteInvite(id: string) {
  await requireAdmin()
  await db.delete(invites).where(eq(invites.id, id))
  revalidatePath('/admin')
  return { success: true }
}

export async function resetUserPassword(userId: string, newPassword: string) {
  await requireAdmin()

  if (newPassword.length < 8) return { error: 'Password must be at least 8 characters.' }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId))
  revalidatePath('/admin')
  return { success: true }
}

export async function updateUserRole(userId: string, role: 'admin' | 'member' | 'readonly') {
  const session = await requireSuperuser()

  if (userId === session.user.id) return { error: 'Cannot change your own role.' }

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId))
  revalidatePath('/admin')
  return { success: true }
}

export async function deleteUser(userId: string) {
  const session = await requireSuperuser()
  if (userId === session.user.id) return { error: 'Cannot delete yourself.' }

  await db.delete(users).where(eq(users.id, userId))
  revalidatePath('/admin')
  return { success: true }
}



async function uploadIconBlob(file: File, scope: 'category' | 'subcategory', id: string, userId: string) {
  if (!file || file.size === 0) return { error: 'Choose an image first.' }
  if (!file.type.startsWith('image/')) return { error: 'Icon must be an image file.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'Icon must be under 5 MB.' }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase()
  const blob = await put(`vault-icons/${scope}/${id}/${Date.now()}-${safeName}`, file, {
    access: 'public',
    contentType: file.type,
  })

  return { url: blob.url, uploadedBy: userId }
}

export async function uploadCategoryIcon(formData: FormData) {
  const session = await requireSuperuser()
  const id = formData.get('id') as string
  const file = formData.get('file') as File
  if (!id) return { error: 'Category is missing.' }

  const uploaded = await uploadIconBlob(file, 'category', id, session.user.id)
  if ('error' in uploaded) return uploaded

  await db.update(categories).set({ icon: uploaded.url }).where(eq(categories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true, icon: uploaded.url }
}

export async function uploadSubcategoryIcon(formData: FormData) {
  const session = await requireSuperuser()
  const id = formData.get('id') as string
  const file = formData.get('file') as File
  if (!id) return { error: 'Subcategory is missing.' }

  const uploaded = await uploadIconBlob(file, 'subcategory', id, session.user.id)
  if ('error' in uploaded) return uploaded

  await db.update(subcategories).set({ icon: uploaded.url }).where(eq(subcategories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true, icon: uploaded.url }
}

export async function updateCategoryIcon(id: string, icon: string) {
  await requireSuperuser()
  const trimmed = icon.trim()
  await db.update(categories).set({ icon: trimmed || null }).where(eq(categories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

export async function updateSubcategoryIcon(id: string, icon: string) {
  await requireSuperuser()
  const trimmed = icon.trim()
  await db.update(subcategories).set({ icon: trimmed || null }).where(eq(subcategories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

export async function addCategory(name: string) {
  await requireSuperuser()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name cannot be empty.' }

  const baseSlug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'

  // Make sure the slug is unique — append -2, -3, … if needed
  const existing = await db.select({ slug: categories.slug }).from(categories)
  const taken = new Set(existing.map((c) => c.slug))
  let slug = baseSlug
  let n = 2
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`

  // Park new categories at the end of the sort order
  const all = await db.select({ sortOrder: categories.sortOrder }).from(categories)
  const maxOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), -1)

  const [created] = await db
    .insert(categories)
    .values({ name: trimmed, slug, sortOrder: maxOrder + 1 })
    .returning()

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true, id: created.id, slug }
}

export async function deleteCategory(id: string) {
  await requireSuperuser()

  // Refuse to delete a category that still has anything in it. The schema
  // cascades entries + files on category delete, so without this guard a
  // single mis-click silently wipes hundreds of records. Force the caller
  // to move the children to a different category first.
  const cat = await db.select().from(categories).where(eq(categories.id, id)).then((r) => r[0])
  if (!cat) return { error: 'Category not found.' }

  const [entryRows, noteRows, fileRows, subRows] = await Promise.all([
    db.select({ id: entries.id }).from(entries).where(eq(entries.categoryId, id)),
    db.select({ id: notes.id }).from(notes).where(eq(notes.categoryId, id)),
    db.select({ id: files.id }).from(files).where(eq(files.categoryId, id)),
    db.select({ id: subcategories.id }).from(subcategories).where(eq(subcategories.categoryId, id)),
  ])

  const blockers: string[] = []
  if (entryRows.length) blockers.push(`${entryRows.length} entr${entryRows.length === 1 ? 'y' : 'ies'}`)
  if (noteRows.length) blockers.push(`${noteRows.length} note${noteRows.length === 1 ? '' : 's'}`)
  if (fileRows.length) blockers.push(`${fileRows.length} file${fileRows.length === 1 ? '' : 's'}`)
  if (subRows.length) blockers.push(`${subRows.length} subcategor${subRows.length === 1 ? 'y' : 'ies'}`)

  if (blockers.length > 0) {
    return {
      error: `"${cat.name}" still contains ${blockers.join(', ')}.`,
      blocked: true as const,
      blockers: {
        entries: entryRows.length,
        notes: noteRows.length,
        files: fileRows.length,
        subcategories: subRows.length,
      },
    }
  }

  await db.delete(categories).where(eq(categories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

export async function updateCategoryName(id: string, name: string) {
  await requireSuperuser()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name cannot be empty.' }
  await db.update(categories).set({ name: trimmed }).where(eq(categories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function updateSubcategoryName(id: string, name: string) {
  await requireSuperuser()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name cannot be empty.' }
  await db.update(subcategories).set({ name: trimmed }).where(eq(subcategories.id, id))
  revalidatePath('/admin')
  return { success: true }
}

export async function addSubcategory(categoryId: string, name: string) {
  await requireSuperuser()
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name cannot be empty.' }
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  await db.insert(subcategories).values({ categoryId, name: trimmed, slug, sortOrder: 9999 })
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteSubcategory(id: string) {
  await requireSuperuser()

  // Same protection as deleteCategory. The schema sets entries.subcategoryId
  // to null on delete (less catastrophic than the category cascade) but
  // un-categorizing rows silently is still a bad UX — force the user to
  // move them first.
  const sub = await db.select().from(subcategories).where(eq(subcategories.id, id)).then((r) => r[0])
  if (!sub) return { error: 'Subcategory not found.' }

  const [entryRows, noteRows] = await Promise.all([
    db.select({ id: entries.id }).from(entries).where(eq(entries.subcategoryId, id)),
    db.select({ id: notes.id }).from(notes).where(eq(notes.subcategoryId, id)),
  ])

  const blockers: string[] = []
  if (entryRows.length) blockers.push(`${entryRows.length} entr${entryRows.length === 1 ? 'y' : 'ies'}`)
  if (noteRows.length) blockers.push(`${noteRows.length} note${noteRows.length === 1 ? '' : 's'}`)

  if (blockers.length > 0) {
    return {
      error: `"${sub.name}" still contains ${blockers.join(' and ')}.`,
      blocked: true as const,
      blockers: {
        entries: entryRows.length,
        notes: noteRows.length,
      },
    }
  }

  await db.delete(subcategories).where(eq(subcategories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function moveSubcategory(id: string, newCategoryId: string) {
  await requireSuperuser()
  await db.update(subcategories).set({ categoryId: newCategoryId }).where(eq(subcategories.id, id))
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  return { success: true }
}

// Promote a subcategory to be its own top-level category. Used in the
// admin category editor's "Move to…" dropdown via the "↑ Promote to
// top-level" sentinel.
//
// What it does:
//   1. Create a new category with the sub's name + icon (slug
//      regenerated to avoid colliding with existing category slugs).
//   2. Re-parent every entry/note/file that referenced the old
//      subcategoryId so they now point at the new top-level category
//      (categoryId = new id, subcategoryId = null). entries.categoryId
//      previously pointed at the SUB's old parent — fixing it to the
//      new category keeps the data consistent with where the user
//      thinks the rows live now.
//   3. Re-parent any nested subcategories (subs whose
//      parentSubcategoryId pointed at this sub) to be top-level subs of
//      the new category.
//   4. Delete the now-empty subcategory row.
//
// Returns the new category id so the caller can navigate / surface it.
export async function promoteSubcategoryToCategory(id: string) {
  await requireSuperuser()

  const sub = await db.select().from(subcategories).where(eq(subcategories.id, id)).then((r) => r[0])
  if (!sub) return { error: 'Subcategory not found.' }

  // Unique slug at the category level. Re-use the sub's slug when
  // possible; otherwise suffix -2, -3, etc.
  const existingSlugs = new Set(
    (await db.select({ slug: categories.slug }).from(categories)).map((c) => c.slug),
  )
  const baseSlug = sub.slug || sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'
  let slug = baseSlug
  let n = 2
  while (existingSlugs.has(slug)) slug = `${baseSlug}-${n++}`

  // Park new category at end of sort order.
  const all = await db.select({ sortOrder: categories.sortOrder }).from(categories)
  const maxOrder = all.reduce((m, c) => Math.max(m, c.sortOrder), -1)

  const [newCat] = await db
    .insert(categories)
    .values({
      name: sub.name,
      slug,
      sortOrder: maxOrder + 1,
      icon: sub.icon ?? null,
    })
    .returning({ id: categories.id })

  // Re-parent entries: any row that lived in <oldParent> > <sub> now
  // lives directly in <newCat>. Clear the subcategoryId so the entry
  // doesn't appear to still belong to the (about-to-be-deleted) sub.
  await db
    .update(entries)
    .set({ categoryId: newCat.id, subcategoryId: null, updatedAt: new Date() })
    .where(eq(entries.subcategoryId, id))

  // Notes have the same shape.
  await db
    .update(notes)
    .set({ categoryId: newCat.id, subcategoryId: null, updatedAt: new Date() })
    .where(eq(notes.subcategoryId, id))

  // (Files don't have a subcategoryId — they reference categories OR
  // entries OR notes directly. Files attached to entries inside this
  // sub follow their entry via the entries re-parent above. Category-
  // level files belong to the OLD parent category and stay there.)

  // Nested subcategories: move them under the new top-level cat.
  await db
    .update(subcategories)
    .set({ categoryId: newCat.id, parentSubcategoryId: null })
    .where(eq(subcategories.parentSubcategoryId, id))

  // Finally remove the now-orphaned subcategory.
  await db.delete(subcategories).where(eq(subcategories.id, id))

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true, newCategoryId: newCat.id, newSlug: slug }
}

// Bump a top-level category up or down by one slot in sortOrder.
// Renormalises the whole list afterward — same approach as the
// subcategory equivalent below — so the order stored in the DB stays
// dense (0, 1, 2, …) regardless of legacy sparse values.
export async function reorderCategory(id: string, direction: 'up' | 'down') {
  await requireSuperuser()

  const all = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))

  const from = all.findIndex((c) => c.id === id)
  if (from === -1) return { error: 'Category not found.' }

  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= all.length) return { success: true }

  const next = [...all]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)

  await Promise.all(
    next.map((item, index) =>
      item.sortOrder === index
        ? Promise.resolve()
        : db.update(categories).set({ sortOrder: index }).where(eq(categories.id, item.id)),
    ),
  )

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

export async function reorderSubcategory(id: string, direction: 'up' | 'down') {
  await requireSuperuser()

  const sub = await db.select().from(subcategories).where(eq(subcategories.id, id)).then((r) => r[0])
  if (!sub) return { error: 'Subcategory not found.' }

  const siblings = await db
    .select()
    .from(subcategories)
    .where(eq(subcategories.categoryId, sub.categoryId))
    .orderBy(asc(subcategories.sortOrder), asc(subcategories.name))

  const from = siblings.findIndex((s) => s.id === id)
  if (from === -1) return { error: 'Subcategory not found.' }

  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= siblings.length) return { success: true }

  const next = [...siblings]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)

  await Promise.all(
    next.map((item, index) =>
      item.sortOrder === index ? Promise.resolve() : db.update(subcategories).set({ sortOrder: index }).where(eq(subcategories.id, item.id))
    )
  )

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

// Bulk-move every child (entries, notes, files, subcategories) from one
// category to another, then delete the now-empty source. Used by the
// delete-blocked modal's "move everything" path so a superuser doesn't
// have to manually reassign hundreds of items.
//
// Subcategories travel with their entries — entry.categoryId and the
// owning subcategory.categoryId both flip to the destination, keeping
// the entry → subcategory link intact.

export async function moveCategoryContentsAndDelete(fromId: string, toId: string) {
  await requireSuperuser()

  if (fromId === toId) return { error: 'Source and destination are the same category.' }

  const [fromCat, toCat] = await Promise.all([
    db.select().from(categories).where(eq(categories.id, fromId)).then((r) => r[0]),
    db.select().from(categories).where(eq(categories.id, toId)).then((r) => r[0]),
  ])
  if (!fromCat) return { error: 'Source category not found.' }
  if (!toCat) return { error: 'Destination category not found.' }

  // Order matters: subcategories first (so their categoryId moves with
  // them), then entries / notes / files (which reference categoryId).
  await db.update(subcategories).set({ categoryId: toId }).where(eq(subcategories.categoryId, fromId))
  await db.update(entries).set({ categoryId: toId, updatedAt: new Date() }).where(eq(entries.categoryId, fromId))
  await db.update(notes).set({ categoryId: toId, updatedAt: new Date() }).where(eq(notes.categoryId, fromId))
  await db.update(files).set({ categoryId: toId }).where(eq(files.categoryId, fromId))

  await db.delete(categories).where(eq(categories.id, fromId))

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

// Bulk-move every entry/note from one subcategory to another (or to "no
// subcategory" by passing null), then delete the now-empty source. Both
// subcategories must live under the same parent category — otherwise the
// move would cross categories silently.

export async function moveSubcategoryContentsAndDelete(
  fromId: string,
  toId: string | null
) {
  await requireSuperuser()

  if (fromId === toId) return { error: 'Source and destination are the same subcategory.' }

  const fromSub = await db.select().from(subcategories).where(eq(subcategories.id, fromId)).then((r) => r[0])
  if (!fromSub) return { error: 'Source subcategory not found.' }

  if (toId !== null) {
    const toSub = await db.select().from(subcategories).where(eq(subcategories.id, toId)).then((r) => r[0])
    if (!toSub) return { error: 'Destination subcategory not found.' }
    if (toSub.categoryId !== fromSub.categoryId) {
      return {
        error:
          'Destination subcategory belongs to a different category. ' +
          'Move the source subcategory itself first (use the move arrow), then retry the delete.',
      }
    }
  }

  await db.update(entries).set({ subcategoryId: toId, updatedAt: new Date() }).where(eq(entries.subcategoryId, fromId))
  await db.update(notes).set({ subcategoryId: toId, updatedAt: new Date() }).where(eq(notes.subcategoryId, fromId))

  await db.delete(subcategories).where(eq(subcategories.id, fromId))

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true }
}

// ─── File reassignment / deletion ────────────────────────────────────────────
//
// Target shape for reassignFile: discriminated union over the three kinds of
// parent a file can have. 'category' bundles an optional subcategory which
// applies only when the file is attached via a parent note/entry (the files
// table itself has no subcategory column).
export type ReassignTarget =
  | { kind: 'category'; categoryId: string; subcategoryId: string | null }
  | { kind: 'note'; noteId: string }
  | { kind: 'entry'; entryId: string }

// applyReassign: in-place mutation for ONE file. Caller has already proven
// superuser. Validates the target exists; returns { error } strings on bad
// input so the bulk loop can collect failures without throwing.
async function applyReassign(fileId: string, target: ReassignTarget): Promise<{ error?: string }> {
  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }

  if (target.kind === 'category') {
    const cat = await db.select().from(categories).where(eq(categories.id, target.categoryId)).then((r) => r[0])
    if (!cat) return { error: 'Category not found.' }
    if (target.subcategoryId) {
      const sub = await db.select().from(subcategories).where(eq(subcategories.id, target.subcategoryId)).then((r) => r[0])
      if (!sub) return { error: 'Subcategory not found.' }
      if (sub.categoryId !== target.categoryId) return { error: 'Subcategory does not belong to that category.' }
    }

    if (file.noteId) {
      // Move the parent note (file travels with it). Note keeps its noteId
      // attachment to the file, just lives under a new category.
      await db.update(notes)
        .set({ categoryId: target.categoryId, subcategoryId: target.subcategoryId, updatedAt: new Date() })
        .where(eq(notes.id, file.noteId))
    } else if (file.entryId) {
      await db.update(entries)
        .set({ categoryId: target.categoryId, subcategoryId: target.subcategoryId, updatedAt: new Date() })
        .where(eq(entries.id, file.entryId))
    } else {
      // Bare file. files table has no subcategory column; sub is dropped.
      await db.update(files).set({ categoryId: target.categoryId }).where(eq(files.id, fileId))
    }
    return {}
  }

  if (target.kind === 'note') {
    const note = await db.select().from(notes).where(eq(notes.id, target.noteId)).then((r) => r[0])
    if (!note) return { error: 'Note not found.' }
    // Detach from current parent and re-bind to the new note. Polymorphic
    // FK — exactly one of (entryId, noteId, categoryId) is set at any time.
    await db.update(files)
      .set({ entryId: null, noteId: target.noteId, categoryId: null })
      .where(eq(files.id, fileId))
    return {}
  }

  if (target.kind === 'entry') {
    const entry = await db.select().from(entries).where(eq(entries.id, target.entryId)).then((r) => r[0])
    if (!entry) return { error: 'Entry not found.' }
    await db.update(files)
      .set({ entryId: target.entryId, noteId: null, categoryId: null })
      .where(eq(files.id, fileId))
    return {}
  }

  return { error: 'Unknown reassign target.' }
}

export async function reassignFile(fileId: string, target: ReassignTarget) {
  await requireSuperuser()
  const res = await applyReassign(fileId, target)
  revalidatePath('/admin/files')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  if (res.error) return res
  return { success: true }
}

export async function bulkReassignFiles(fileIds: string[], target: ReassignTarget) {
  await requireSuperuser()
  if (!Array.isArray(fileIds) || fileIds.length === 0) return { error: 'No files selected.' }
  if (fileIds.length > 200) return { error: 'Pick fewer than 200 files at a time.' }

  // Sequential by design. Pre-validating the target once is tempting, but
  // doing it inside applyReassign keeps a single source of truth and the
  // overall budget of ~200 quick UPDATEs is fine on Neon.
  const failures: { fileId: string; error: string }[] = []
  let ok = 0
  for (const id of fileIds) {
    const res = await applyReassign(id, target)
    if (res.error) failures.push({ fileId: id, error: res.error })
    else ok++
  }

  revalidatePath('/admin/files')
  revalidatePath('/dashboard')
  revalidatePath('/categories', 'layout')
  return { success: true, ok, failed: failures.length, failures }
}

// adminDeleteFile: superuser-only purge of a file (DB row + Vercel Blob).
// The user-facing deleteFile() in src/lib/actions/files.ts enforces the
// per-file isPrivate visibility rules; this one bypasses them so Lance
// can clean up imports gone wrong.

export async function adminDeleteFile(fileId: string) {
  await requireSuperuser()

  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return { error: 'File not found.' }

  try {
    await del(file.blobUrl)
  } catch {
    // Blob may already be gone — delete the DB row regardless so it stops
    // appearing in the listing.
  }
  await db.delete(files).where(eq(files.id, fileId))

  revalidatePath('/admin/files')
  return { success: true }
}

export async function bulkDeleteFiles(fileIds: string[]) {
  await requireSuperuser()
  if (!Array.isArray(fileIds) || fileIds.length === 0) return { error: 'No files selected.' }
  if (fileIds.length > 200) return { error: 'Pick fewer than 200 files at a time.' }

  let ok = 0
  let failed = 0
  for (const id of fileIds) {
    const file = await db.select().from(files).where(eq(files.id, id)).then((r) => r[0])
    if (!file) { failed++; continue }
    try { await del(file.blobUrl) } catch { /* blob may already be gone */ }
    await db.delete(files).where(eq(files.id, id))
    ok++
  }

  revalidatePath('/admin/files')
  return { success: true, ok, failed }
}
