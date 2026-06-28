'use server'

import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

export async function createSuperuser(formData: FormData) {
  // Hard requirement: SETUP_KEY must be set in the environment. We refuse to
  // run with a default fallback because /setup creates a superuser — anyone
  // who hit it after a DB wipe with a known default could claim the vault.
  const expectedKey = process.env.SETUP_KEY
  if (!expectedKey) {
    return { error: 'Setup is disabled. SETUP_KEY env var is not configured.' }
  }

  // Guard: abort if any superuser already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'superuser'))
    .then((r) => r[0])

  if (existing) return { error: 'Setup already complete. A superuser already exists.' }

  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string
  const setupKey = formData.get('setupKey') as string

  if (!name || !email || !password) return { error: 'All fields are required.' }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }
  if (password.length < 10) return { error: 'Password must be at least 10 characters.' }

  if (setupKey !== expectedKey) return { error: 'Invalid setup key.' }

  const emailTaken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .then((r) => r[0])

  if (emailTaken) return { error: 'That email is already in use.' }

  const passwordHash = await bcrypt.hash(password, 12)

  await db.insert(users).values({
    name,
    email,
    role: 'superuser',
    passwordHash,
  })

  return { success: true }
}
