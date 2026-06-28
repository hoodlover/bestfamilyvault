'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { put } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { isOwnerEmail } from '@/lib/family-config'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

export async function updateProfile(formData: FormData) {
  const session = await getSession()
  const name = (formData.get('name') as string)?.trim()
  const dobRaw = (formData.get('dateOfBirth') as string ?? '').trim()
  const phone = blankToNull(formData.get('phone'))
  const address = blankToNull(formData.get('address'))
  const ssn = blankToNull(formData.get('ssn'))
  const driversLicense = blankToNull(formData.get('driversLicense'))
  // v264 — both stored as YYYY-MM-DD text on the users table (the
  // Family Info popout renders them as MM/DD/YYYY from there).
  const driversLicenseExpiry = blankToNull(formData.get('driversLicenseExpiry'))
  const passport = blankToNull(formData.get('passport'))
  const anniversary = blankToNull(formData.get('anniversary'))

  if (!name) return { error: 'Name is required.' }

  // dateOfBirth: empty string clears it; YYYY-MM-DD parses to a UTC midnight
  // date so the dashboard's MM/DD comparison doesn't drift across timezones.
  let dateOfBirth: Date | null | undefined = undefined
  if (dobRaw === '') {
    dateOfBirth = null
  } else if (dobRaw) {
    const parsed = new Date(dobRaw + 'T00:00:00Z')
    if (Number.isNaN(parsed.getTime())) return { error: 'Birthday must be YYYY-MM-DD.' }
    dateOfBirth = parsed
  }

  await db
    .update(users)
    .set({
      name,
      phone,
      address,
      ssn,
      driversLicense,
      driversLicenseExpiry,
      passport,
      anniversary,
      ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id))

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true }
}

function blankToNull(value: FormDataEntryValue | null) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

// Owner-only edit of another family member's profile fields. Lance asked
// for this so he can pre-fill phone / SSN / DOB / DL / passport / address
// for family members who don't know all their own info — the popout shows
// every row pulling from users.*, so editing here writes the same shape
// the popout reads back. Same field set as updateProfile.
export async function updateFamilyMemberProfile(targetUserId: string, formData: FormData) {
  const session = await getSession()
  // Gate: owner email OR superuser role. Anyone else can't write to a
  // user row that isn't their own.
  const isOwner = isOwnerEmail(session.user.email)
  const isSuper = session.user.role === 'superuser'
  if (!isOwner && !isSuper) return { error: 'Only the family owner can edit other profiles.' }
  if (!targetUserId) return { error: 'Missing target user.' }

  const name = (formData.get('name') as string)?.trim()
  const dobRaw = (formData.get('dateOfBirth') as string ?? '').trim()
  const phone = blankToNull(formData.get('phone'))
  const address = blankToNull(formData.get('address'))
  const ssn = blankToNull(formData.get('ssn'))
  const driversLicense = blankToNull(formData.get('driversLicense'))
  const driversLicenseExpiry = blankToNull(formData.get('driversLicenseExpiry'))
  const passport = blankToNull(formData.get('passport'))
  const anniversary = blankToNull(formData.get('anniversary'))

  if (!name) return { error: 'Name is required.' }

  let dateOfBirth: Date | null | undefined = undefined
  if (dobRaw === '') {
    dateOfBirth = null
  } else if (dobRaw) {
    const parsed = new Date(dobRaw + 'T00:00:00Z')
    if (Number.isNaN(parsed.getTime())) return { error: 'Birthday must be YYYY-MM-DD.' }
    dateOfBirth = parsed
  }

  await db
    .update(users)
    .set({
      name,
      phone,
      address,
      ssn,
      driversLicense,
      driversLicenseExpiry,
      passport,
      anniversary,
      ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetUserId))

  // Family Info popout lives on the dashboard; revalidate that path so a
  // re-render picks up the new values without a hard refresh.
  revalidatePath('/dashboard')
  return { success: true }
}

export async function changePassword(formData: FormData) {
  const session = await getSession()
  const currentPassword = formData.get('currentPassword') as string
  const newPassword = formData.get('newPassword') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: 'All fields are required.' }
  }

  if (newPassword !== confirmPassword) {
    return { error: 'New passwords do not match.' }
  }

  if (newPassword.length < 8) {
    return { error: 'New password must be at least 8 characters.' }
  }

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .then((r) => r[0])

  if (!user?.passwordHash) return { error: 'Account not configured for password login.' }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) return { error: 'Current password is incorrect.' }

  const newHash = await bcrypt.hash(newPassword, 12)
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return { success: true }
}

const MAX_AVATAR_BYTES = 1 * 1024 * 1024 // 1 MB — applies to user-uploaded source

export async function updateAvatar(formData: FormData) {
  try {
    const session = await getSession()
    const cropped = formData.get('avatar') as File | null
    const original = formData.get('original') as File | null

    if (!cropped || cropped.size === 0) return { error: 'No image data.' }
    if (!cropped.type.startsWith('image/')) return { error: 'File must be an image.' }

    // The cropped output is generated client-side and is small, so the 1 MB cap
    // is enforced on the user-uploaded original.
    if (original && original.size > MAX_AVATAR_BYTES) {
      return { error: 'Source image must be under 1 MB.' }
    }

    const stamp = Date.now()
    // Avatars live in a private Vercel Blob store; URLs are served via the
    // /api/avatars/[userId] proxy which fetches with the read/write token.
    const croppedBlob = await put(
      `avatars/${session.user.id}-${stamp}-crop.jpg`,
      cropped,
      { access: 'private', contentType: cropped.type, allowOverwrite: true }
    )

    const updates: { image: string; imageOriginal?: string; updatedAt: Date } = {
      image: croppedBlob.url,
      updatedAt: new Date(),
    }

    if (original && original.size > 0) {
      const ext = original.name.includes('.')
        ? original.name.slice(original.name.lastIndexOf('.'))
        : '.jpg'
      const originalBlob = await put(
        `avatars/${session.user.id}-${stamp}-src${ext}`,
        original,
        { access: 'private', contentType: original.type, allowOverwrite: true }
      )
      updates.imageOriginal = originalBlob.url
    }

    await db.update(users).set(updates).where(eq(users.id, session.user.id))

    revalidatePath('/settings')
    revalidatePath('/dashboard')
    return { success: true, url: croppedBlob.url }
  } catch (err) {
    console.error('updateAvatar error:', err)
    return { error: err instanceof Error ? err.message : 'Avatar upload failed.' }
  }
}

export async function removeAvatar() {
  const session = await getSession()
  await db
    .update(users)
    .set({ image: null, imageOriginal: null, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))
  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { success: true }
}

// Update the signed-in user's accent theme. Valid values match the
// [data-theme="…"] blocks in globals.css; anything else is rejected so a
// typo doesn't leave the user on the :root default with no signal.
const VALID_THEME_ACCENTS = new Set(['forest', 'crimson', 'midnight', 'harvest'])

export async function updateThemeAccent(accent: string) {
  const session = await getSession()
  if (!VALID_THEME_ACCENTS.has(accent)) {
    return { error: 'Unknown theme.' }
  }
  await db
    .update(users)
    .set({ themeAccent: accent })
    .where(eq(users.id, session.user.id))
  // Theme affects every layout-rendered surface; revalidate broadly so
  // sidebar/drawer/dashboard active-state colors swap immediately.
  revalidatePath('/', 'layout')
  return { success: true, accent }
}

// ─── Tool drawer order (long-press + drag reorder) ──────────────────────────
//
// Each user can drag-reorder the tiles in the mobile slide-up tools drawer.
// The order is stored as an array of stable tile keys (see TOOL_DRAWER_TILES
// in mobile-tools-drawer.tsx). Unknown / removed keys are filtered on save,
// duplicates are de-duped, and new tiles added in code later are appended
// to the end on read so a stale saved order never erases new entries.
//
// SETUP NOTE: this writes to users.tool_drawer_order — run `npm run db:push`
// once after pulling this commit so the column exists on prod. The save +
// read paths both soft-fail until then so an unmigrated env doesn't crash
// the drawer (you just get the default order).

/** Persist the user's drag-reorder choice. The client filters input to
 *  known tile keys before sending; this server-side dedupes + caps for
 *  defense in depth. */
export async function saveToolDrawerOrder(order: string[]): Promise<{ success?: boolean; error?: string }> {
  try {
    const session = await getSession()
    if (!Array.isArray(order)) return { error: 'order must be an array of strings.' }
    // Cap at 40 entries — current tile count is 16, far below this. The
    // cap is there in case a future bug starts shipping junk strings.
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const key of order) {
      if (typeof key !== 'string') continue
      const trimmed = key.trim()
      if (!trimmed || trimmed.length > 64) continue
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      cleaned.push(trimmed)
      if (cleaned.length >= 40) break
    }
    await db
      .update(users)
      .set({ toolDrawerOrder: cleaned })
      .where(eq(users.id, session.user.id))
    // No path revalidation — the drawer hydrates from props and the
    // change has already been reflected client-side via the dnd-kit
    // arrayMove before this save lands.
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save the new order.'
    // If the column doesn't exist yet on prod the error message will
    // mention "tool_drawer_order" — surface a friendlier hint.
    if (/tool_drawer_order/i.test(msg)) {
      return { error: 'Drag-reorder needs `npm run db:push` to add the column.' }
    }
    return { error: msg }
  }
}

/** Read the current user's saved tile order. Returns an empty array on
 *  any failure (column missing, no session, etc.) so the caller can
 *  fall back to the default order without crashing. */
export async function getMyToolDrawerOrder(): Promise<string[]> {
  try {
    const session = await auth()
    if (!session?.user?.id) return []
    const row = await db
      .select({ order: users.toolDrawerOrder })
      .from(users)
      .where(eq(users.id, session.user.id))
      .then((r) => r[0])
    return (row?.order ?? []).filter((k): k is string => typeof k === 'string')
  } catch {
    return []
  }
}
