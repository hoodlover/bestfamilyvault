'use server'

import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'

export async function createOnboardingVaultAccount(formData: FormData) {
  const name = String(formData.get('ownerName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const phone = String(formData.get('phone') ?? '').trim()
  const addressLine1 = String(formData.get('addressLine1') ?? '').trim()
  const addressLine2 = String(formData.get('addressLine2') ?? '').trim()
  const city = String(formData.get('city') ?? '').trim()
  const stateRegion = String(formData.get('stateRegion') ?? '').trim()
  const postalCode = String(formData.get('postalCode') ?? '').trim()

  if (!name || !email || !password) return { error: 'Name, email, and password are required.' }
  if (!email.includes('@')) return { error: 'Enter a valid email address.' }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }
  if (password.length < 10) return { error: 'Password must be at least 10 characters.' }

  const existingOwner = await db.select({ id: users.id }).from(users).limit(1).then((rows) => rows[0] ?? null)
  if (existingOwner) {
    return { error: 'This vault already has an owner. Sign in or ask the owner for an invite.' }
  }

  const emailTaken = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).then((rows) => rows[0] ?? null)
  if (emailTaken) return { error: 'That email is already in use.' }

  const cityStateZip = [city, [stateRegion, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const address = [addressLine1, addressLine2, cityStateZip].filter(Boolean).join('\n')
  const passwordHash = await bcrypt.hash(password, 12)

  await db.insert(users).values({
    name,
    email,
    phone: phone || null,
    address: address || null,
    role: 'superuser',
    passwordHash,
  })

  return { success: true }
}
