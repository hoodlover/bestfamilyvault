'use server'

// Backing store for the /meal-plan/quick-pick page's staple list.
// Family-wide (no userId); the entire household edits the same set.
// On first visit, ensureQuickPickSeeded() copies the static
// GROCERY_STAPLES list into the table; after that all edits go
// through the action set below.

import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { quickPickItems } from '@/lib/db/schema'
import { GROCERY_STAPLES } from '@/lib/grocery-staples'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

async function requireWriter() {
  const session = await requireUser()
  if (session.user.role === 'readonly') throw new Error('Read-only access.')
  return session
}

function bumpPaths() {
  revalidatePath('/meal-plan/quick-pick')
}

export interface QuickPickItemRow {
  id: string
  category: string
  name: string
  sortOrder: number
}

/**
 * Lazy-seed: if the table is empty, populate it once from the static
 * GROCERY_STAPLES list. Read-safe; doesn't require writer permission
 * because the very first user (read-only or not) should get a
 * working page, and the inserts are deterministic from the static
 * source.
 */
export async function ensureQuickPickSeeded(): Promise<void> {
  await requireUser()
  const existing = await db
    .select({ id: quickPickItems.id })
    .from(quickPickItems)
    .limit(1)
  if (existing.length > 0) return

  const rows: { category: string; name: string; sortOrder: number }[] = []
  for (const cat of GROCERY_STAPLES) {
    cat.items.forEach((name, i) => {
      rows.push({ category: cat.name, name, sortOrder: (i + 1) * 10 })
    })
  }
  if (rows.length === 0) return
  await db.insert(quickPickItems).values(rows)
}

/** Full list, sorted by the order categories appear in GROCERY_STAPLES
 *  (so a UI render still groups consistently), then by sortOrder. */
export async function getQuickPickItems(): Promise<QuickPickItemRow[]> {
  await requireUser()
  const all = await db
    .select()
    .from(quickPickItems)
    .orderBy(asc(quickPickItems.sortOrder), asc(quickPickItems.createdAt))
  return all.map((r) => ({
    id: r.id,
    category: r.category,
    name: r.name,
    sortOrder: r.sortOrder,
  }))
}

export async function addQuickPickItem(category: string, name: string) {
  await requireWriter()
  const cat = category.trim()
  const n = name.trim()
  if (!cat) return { error: 'Category is required.' }
  if (!n) return { error: 'Name is required.' }

  // Append at the bottom of its category: take max sortOrder in this
  // category + 10. Cheap one-shot aggregate.
  const existing = await db
    .select({ sortOrder: quickPickItems.sortOrder })
    .from(quickPickItems)
    .where(eq(quickPickItems.category, cat))
  const max = existing.reduce((m, r) => Math.max(m, r.sortOrder), 0)

  await db.insert(quickPickItems).values({
    category: cat,
    name: n,
    sortOrder: max + 10,
  })
  bumpPaths()
  return { success: true }
}

export async function renameQuickPickItem(id: string, newName: string) {
  await requireWriter()
  const n = newName.trim()
  if (!n) return { error: 'Name cannot be empty.' }
  await db.update(quickPickItems).set({ name: n }).where(eq(quickPickItems.id, id))
  bumpPaths()
  return { success: true }
}

export async function deleteQuickPickItem(id: string) {
  await requireWriter()
  await db.delete(quickPickItems).where(eq(quickPickItems.id, id))
  bumpPaths()
  return { success: true }
}
