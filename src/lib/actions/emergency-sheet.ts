'use server'

// Toggle the `emergency-sheet` tag on an entry. Drives which logins
// surface on the printable /now-what/emergency-sheet page.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { EMERGENCY_SHEET_TAG } from '@/lib/emergency-sheet-tag'

export async function toggleEmergencySheetTag(entryId: string, include: boolean) {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized' }
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db
    .select({ tags: entries.tags, isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
    .from(entries)
    .where(eq(entries.id, entryId))
    .then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }

  // Reuse the standard visibility rules: superuser bypasses isPrivate but
  // NOT isPersonal (owner-only).
  if (entry.isPrivate && session.user.role !== 'superuser') return { error: 'Access denied.' }
  if (entry.isPersonal && entry.createdBy !== session.user.id) return { error: 'Access denied.' }

  const current = entry.tags ?? []
  const without = current.filter((t) => t !== EMERGENCY_SHEET_TAG)
  const next = include ? [...without, EMERGENCY_SHEET_TAG] : without

  await db
    .update(entries)
    .set({ tags: next.length > 0 ? next : null })
    .where(eq(entries.id, entryId))

  revalidatePath('/admin/emergency-sheet')
  revalidatePath('/now-what/emergency-sheet')
  return { ok: true, included: include }
}
