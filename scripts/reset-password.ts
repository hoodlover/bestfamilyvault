// Reset a user's password from the command line. Use when a family member
// (Heather, the kids) forgets theirs and the in-app self-serve reset flow
// doesn't exist yet.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/reset-password.ts <email>
//   npx tsx --env-file=.env.local scripts/reset-password.ts <email> <new-password>
//
// If <new-password> is omitted, a random 14-character one is generated and
// printed once. Hand it to the user, tell them to sign in and change it
// from Settings → Change Password.
//
// Refuses to run if the user has the Magnificent role of Probably Heather And
// You're About To Reset Yours unless you pass --i-know. Just a small guard
// against typos when you'd rather not log Lance's password to the terminal.

import bcrypt from 'bcryptjs'
import * as crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { users } from '../src/lib/db/schema'

const SELF_GUARD = '--i-know'

function generatePassword(): string {
  // 14 chars from the URL-safe alphabet — easy to read out over the phone,
  // hard to brute-force, no ambiguous 0/O/1/l characters.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  let out = ''
  const bytes = crypto.randomBytes(14)
  for (let i = 0; i < 14; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== SELF_GUARD)
  const allowSelf = process.argv.includes(SELF_GUARD)
  const [emailArg, passwordArg] = args

  if (!emailArg) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/reset-password.ts <email> [<password>]')
    process.exit(1)
  }

  const email = emailArg.trim().toLowerCase()
  // Explicit column list — selecting * blows up if a schema-pending column
  // (like date_of_birth or voice_memo_blob_url) hasn't been pushed to this
  // database yet. We only need id/name/email/role to do the reset.
  const user = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .then((r) => r[0])
  if (!user) {
    console.error(`No user with email "${email}" found.`)
    process.exit(1)
  }

  if (user.role === 'superuser' && !allowSelf) {
    console.error(`Refusing to reset a superuser password without --i-know flag.`)
    console.error(`If you really meant to do this, re-run with --i-know.`)
    process.exit(1)
  }

  const newPassword = (passwordArg ?? '').trim() || generatePassword()
  const generated = !passwordArg

  if (newPassword.length < 8) {
    console.error('Password must be at least 8 characters.')
    process.exit(1)
  }

  const hash = await bcrypt.hash(newPassword, 10)
  await db.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, user.id))

  console.log()
  console.log(`Reset password for ${user.name ?? user.email} (${user.role}).`)
  if (generated) {
    console.log()
    console.log(`  New password: ${newPassword}`)
    console.log()
    console.log('Hand it over directly — this won\'t be shown again. Tell them to sign in and')
    console.log('change it from Settings → Change Password.')
  } else {
    console.log('(used the password you supplied — not echoing)')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
