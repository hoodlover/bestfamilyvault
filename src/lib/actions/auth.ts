'use server'

import { eq, and, gt } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { users, invites } from '@/lib/db/schema'

export async function registerWithInvite(formData: FormData) {
  const token = formData.get('token') as string
  const name = formData.get('name') as string
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (!token || !name || !password) {
    return { error: 'All fields are required.' }
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' }
  }

  if (password.length < 10) {
    return { error: 'Password must be at least 10 characters.' }
  }

  // Atomically claim the invite: flip status to 'accepted' only if it's still
  // pending and unexpired. If two registrations race the same token, only one
  // wins. The losing call gets zero rows back and bails before creating a
  // duplicate user.
  const [claimed] = await db
    .update(invites)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(
      and(
        eq(invites.token, token),
        eq(invites.status, 'pending'),
        gt(invites.expiresAt, new Date())
      )
    )
    .returning()

  if (!claimed) {
    return { error: 'Invite link is invalid or has expired.' }
  }

  // Check if user already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, claimed.email))
    .then((r) => r[0] ?? null)

  if (existing) {
    // Roll back the claim so the email's owner can retry once the duplicate
    // is resolved manually.
    await db
      .update(invites)
      .set({ status: 'pending', acceptedAt: null })
      .where(eq(invites.id, claimed.id))
    return { error: 'An account with this email already exists.' }
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await db.insert(users).values({
    name,
    email: claimed.email,
    role: claimed.role,
    passwordHash,
    invitedBy: claimed.invitedBy,
  })

  return { success: true }
}
