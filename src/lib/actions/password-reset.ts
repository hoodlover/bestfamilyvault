'use server'

import { and, eq, gt, isNull } from 'drizzle-orm'
import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { users, passwordResetTokens } from '@/lib/db/schema'
import { sendPasswordResetEmail } from '@/lib/email'

const TOKEN_BYTES = 32
const EXPIRY_MS = 60 * 60 * 1000 // 1 hour
const MIN_PASSWORD_LENGTH = 8

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function getAppUrl(): string {
  // NEXT_PUBLIC_APP_URL is set in Vercel prod env. Fall back to localhost
  // for local dev so the email link works there too.
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

interface RequestResult { success?: true; error?: string }

export async function requestPasswordReset(formData: FormData): Promise<RequestResult> {
  const email = (formData.get('email') as string ?? '').trim().toLowerCase()
  if (!email) return { error: 'Enter your email.' }

  // Always succeed from the user's perspective so we don't leak which emails
  // are registered. Real work happens regardless of whether the user exists.
  const user = await db.select().from(users).where(eq(users.email, email)).then((r) => r[0])
  if (user) {
    const token = randomBytes(TOKEN_BYTES).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + EXPIRY_MS)

    await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt })

    const resetUrl = `${getAppUrl().replace(/\/$/, '')}/reset-password?token=${token}`
    const firstName = (user.name ?? '').trim().split(/\s+/)[0] ?? ''

    try {
      await sendPasswordResetEmail({ to: user.email!, firstName, resetUrl })
    } catch (err) {
      // The user always sees success so we don't leak which emails are
      // registered — but a send failure is a real system problem, not a
      // no-op. Log it loudly with where to look, and in non-production
      // rethrow so a misconfigured mailer (empty/typo'd SMTP_* env vars)
      // can't hide silently the way it did before.
      console.error(
        '[password-reset] EMAIL SEND FAILED for a registered user — check the ' +
          'SMTP_* env vars and run scripts/test-email.ts. Error:',
        err
      )
      if (process.env.NODE_ENV !== 'production') throw err
    }
  }

  return { success: true }
}

interface ResetResult { success?: true; error?: string }

export async function resetPasswordWithToken(formData: FormData): Promise<ResetResult> {
  const token = (formData.get('token') as string ?? '').trim()
  const newPassword = (formData.get('newPassword') as string ?? '')
  const confirm = (formData.get('confirmPassword') as string ?? '')

  if (!token) return { error: 'Reset link is missing or malformed.' }
  if (!newPassword) return { error: 'Pick a new password.' }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (newPassword !== confirm) return { error: 'Passwords don’t match.' }

  const tokenHash = hashToken(token)
  const now = new Date()

  // Find a matching token that hasn't been consumed and hasn't expired.
  const row = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        gt(passwordResetTokens.expiresAt, now),
        isNull(passwordResetTokens.consumedAt)
      )
    )
    .then((r) => r[0])

  if (!row) return { error: 'This reset link has expired or has already been used. Request a new one.' }

  // Update the password (bcrypt with the same cost factor as the admin reset
  // action and the credentials provider's hash on registration) and mark the
  // token consumed atomically-ish — back-to-back updates, since Drizzle
  // doesn't ship transactions on the neon-http driver.
  const passwordHash = await bcrypt.hash(newPassword, 12)
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId))
  await db.update(passwordResetTokens).set({ consumedAt: new Date() }).where(eq(passwordResetTokens.id, row.id))

  return { success: true }
}
