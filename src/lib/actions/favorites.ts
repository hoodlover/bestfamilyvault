'use server'

// Per-user favorites. Each user has their own favorites list backed by
// the entry_favorite + note_favorite join tables. Toggle actions are
// exported for cards/buttons that flip a single item; the read helpers
// (getMyEntryFavoriteIds / getMyNoteFavoriteIds) are exported for pages
// that need to render the user's current favorite set.

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entryFavorites, noteFavorites } from '@/lib/db/schema'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

// ─── Read helpers (for pages) ────────────────────────────────────────────────

export async function getMyEntryFavoriteIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ entryId: entryFavorites.entryId })
    .from(entryFavorites)
    .where(eq(entryFavorites.userId, userId))
  return new Set(rows.map((r) => r.entryId))
}

export async function getMyNoteFavoriteIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ noteId: noteFavorites.noteId })
    .from(noteFavorites)
    .where(eq(noteFavorites.userId, userId))
  return new Set(rows.map((r) => r.noteId))
}

// ─── Toggles (called from forms / star buttons) ──────────────────────────────

export async function setEntryFavorite(entryId: string, favorite: boolean) {
  const session = await requireUser()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const existing = await db
    .select({ id: entryFavorites.id })
    .from(entryFavorites)
    .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, entryId)))
    .then((r) => r[0])

  if (favorite && !existing) {
    await db.insert(entryFavorites).values({ userId: session.user.id, entryId })
  } else if (!favorite && existing) {
    await db.delete(entryFavorites).where(eq(entryFavorites.id, existing.id))
  }

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')
  return { success: true }
}

export async function toggleEntryFavorite(entryId: string) {
  const session = await requireUser()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const existing = await db
    .select({ id: entryFavorites.id })
    .from(entryFavorites)
    .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, entryId)))
    .then((r) => r[0])

  if (existing) {
    await db.delete(entryFavorites).where(eq(entryFavorites.id, existing.id))
  } else {
    await db.insert(entryFavorites).values({ userId: session.user.id, entryId })
  }

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')
  return { success: true, isFavorite: !existing }
}

export async function setNoteFavorite(noteId: string, favorite: boolean) {
  const session = await requireUser()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const existing = await db
    .select({ id: noteFavorites.id })
    .from(noteFavorites)
    .where(and(eq(noteFavorites.userId, session.user.id), eq(noteFavorites.noteId, noteId)))
    .then((r) => r[0])

  if (favorite && !existing) {
    await db.insert(noteFavorites).values({ userId: session.user.id, noteId })
  } else if (!favorite && existing) {
    await db.delete(noteFavorites).where(eq(noteFavorites.id, existing.id))
  }

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')
  return { success: true }
}

export async function toggleNoteFavorite(noteId: string) {
  const session = await requireUser()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const existing = await db
    .select({ id: noteFavorites.id })
    .from(noteFavorites)
    .where(and(eq(noteFavorites.userId, session.user.id), eq(noteFavorites.noteId, noteId)))
    .then((r) => r[0])

  if (existing) {
    await db.delete(noteFavorites).where(eq(noteFavorites.id, existing.id))
  } else {
    await db.insert(noteFavorites).values({ userId: session.user.id, noteId })
  }

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')
  return { success: true, isFavorite: !existing }
}
