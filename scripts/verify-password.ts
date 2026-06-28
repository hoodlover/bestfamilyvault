// Diagnostic: check whether a given password matches the stored hash for a user.
// Used when "reset-password.ts says success but login still fails" — confirms
// whether the script wrote to the same DB the app is reading from.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/verify-password.ts <email> <password>

import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { users } from '../src/lib/db/schema'

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2)
  if (!emailArg || !passwordArg) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/verify-password.ts <email> <password>')
    process.exit(1)
  }

  // Print the DB host so we can confirm we're hitting the right DB.
  const url = process.env.DATABASE_URL ?? ''
  const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'
  console.log(`DATABASE_URL host: ${host}`)

  const email = emailArg.trim().toLowerCase()
  const user = await db
    .select({ id: users.id, email: users.email, role: users.role, passwordHash: users.passwordHash, updatedAt: users.updatedAt })
    .from(users)
    .where(eq(users.email, email))
    .then((r) => r[0])

  if (!user) {
    console.error(`No user with email "${email}" found in this DB.`)
    process.exit(1)
  }

  console.log(`Found user: ${user.email} (${user.role})`)
  console.log(`Last updated: ${user.updatedAt?.toISOString() ?? '(none)'}`)
  console.log(`Hash prefix: ${user.passwordHash?.slice(0, 7) ?? '(no hash)'}`)

  if (!user.passwordHash) {
    console.error('User has no passwordHash set.')
    process.exit(1)
  }

  const ok = await bcrypt.compare(passwordArg, user.passwordHash)
  console.log()
  console.log(ok ? '✅ Password MATCHES the stored hash.' : '❌ Password does NOT match the stored hash.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
