'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, categories, subcategories } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role === 'readonly') throw new Error('Read-only access.')
  return session
}

// ─── CSV row type for entries ─────────────────────────────────────────────────

export interface EntryImportRow {
  title: string
  username?: string
  password?: string
  url?: string
  category?: string
  subcategory?: string
  notes?: string
  favorite?: string
  private?: string
}

export interface NoteImportRow {
  title: string
  content?: string
  category?: string
  subcategory?: string
  private?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTruthy(val?: string) {
  return ['yes', 'true', '1', 'y'].includes((val ?? '').toLowerCase().trim())
}

// ─── Import login entries from CSV rows ───────────────────────────────────────

export async function importEntriesCSV(rows: EntryImportRow[]): Promise<{
  inserted: number
  skipped: number
  errors: string[]
}> {
  const session = await getSession()
  const userId = session.user.id

  const allCats = await db.select().from(categories)
  const allSubs = await db.select().from(subcategories)

  // Build lookup maps (case-insensitive by name)
  const catByName = new Map(allCats.map((c) => [c.name.toLowerCase(), c]))
  const catBySlug = new Map(allCats.map((c) => [c.slug.toLowerCase(), c]))
  const subByName = new Map(allSubs.map((s) => [s.name.toLowerCase(), s]))

  const fallbackCat = allCats.find((c) => c.isDefault) ?? allCats[0]
  if (!fallbackCat) return { inserted: 0, skipped: 0, errors: ['No categories found in vault.'] }

  const toInsert: (typeof entries.$inferInsert)[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // 1-indexed + header row

    if (!row.title?.trim()) {
      errors.push(`Row ${rowNum}: missing title — skipped`)
      skipped++
      continue
    }

    // Resolve category
    const catKey = row.category?.trim().toLowerCase() ?? ''
    const cat = catByName.get(catKey) ?? catBySlug.get(catKey) ?? fallbackCat

    // Resolve subcategory
    let subId: string | null = null
    if (row.subcategory?.trim()) {
      const subKey = row.subcategory.trim().toLowerCase()
      const sub = subByName.get(subKey)
      if (sub && sub.categoryId === cat.id) subId = sub.id
    }

    const url = row.url?.trim() || null
    // Auto-prefix bare domains
    const normalizedUrl =
      url && !url.startsWith('http') && url.includes('.') ? `https://${url}` : url

    toInsert.push({
      categoryId: cat.id,
      subcategoryId: subId,
      type: 'login',
      title: row.title.trim(),
      username: row.username?.trim() || null,
      password: encrypt(row.password?.trim() || null),
      url: normalizedUrl,
      noteContent: encrypt(row.notes?.trim() || null),
      isFavorite: isTruthy(row.favorite),
      isPrivate: isTruthy(row.private),
      createdBy: userId,
      updatedBy: userId,
    })
  }

  const BATCH = 100
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await db.insert(entries).values(toInsert.slice(i, i + BATCH))
  }

  revalidatePath('/dashboard')
  revalidatePath('/(dashboard)', 'layout')

  return { inserted: toInsert.length, skipped, errors }
}

// ─── Import notes ─────────────────────────────────────────────────────────────

export async function importNotesCSV(rows: NoteImportRow[]): Promise<{
  inserted: number
  skipped: number
  errors: string[]
}> {
  const session = await getSession()
  const userId = session.user.id

  const allCats = await db.select().from(categories)
  const allSubs = await db.select().from(subcategories)

  const catByName = new Map(allCats.map((c) => [c.name.toLowerCase(), c]))
  const catBySlug = new Map(allCats.map((c) => [c.slug.toLowerCase(), c]))
  const subByName = new Map(allSubs.map((s) => [s.name.toLowerCase(), s]))

  const fallbackCat = allCats.find((c) => c.isDefault) ?? allCats[0]

  const toInsert: (typeof notes.$inferInsert)[] = []
  const errors: string[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2

    if (!row.title?.trim()) {
      errors.push(`Row ${rowNum}: missing title — skipped`)
      skipped++
      continue
    }

    const catKey = row.category?.trim().toLowerCase() ?? ''
    const cat = catByName.get(catKey) ?? catBySlug.get(catKey) ?? fallbackCat

    let subId: string | null = null
    if (row.subcategory?.trim() && cat) {
      const sub = subByName.get(row.subcategory.trim().toLowerCase())
      if (sub && sub.categoryId === cat.id) subId = sub.id
    }

    const rawContent = row.content?.trim() ?? ''
    toInsert.push({
      categoryId: cat?.id ?? null,
      subcategoryId: subId,
      title: row.title.trim(),
      content: rawContent === '' ? '' : (encrypt(rawContent) ?? ''),
      isPrivate: isTruthy(row.private),
      isFavorite: false,
      createdBy: userId,
      updatedBy: userId,
    })
  }

  const BATCH = 100
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await db.insert(notes).values(toInsert.slice(i, i + BATCH))
  }

  revalidatePath('/dashboard')
  revalidatePath('/notes')

  return { inserted: toInsert.length, skipped, errors }
}
