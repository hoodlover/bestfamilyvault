// Manual test-push trigger from the CLI. Sends a push to every
// device a given user has subscribed. Useful for spot-checking that
// a newly-added phone (or fresh deploy) actually receives.
//
// Run:
//   npx tsx --env-file=.env.local scripts/send-test-push.ts lance.climb@gmail.com
//
// Optional second arg overrides the message body:
//   npx tsx --env-file=.env.local scripts/send-test-push.ts lance.climb@gmail.com "S25 check"

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { sendPushToUser } from '@/lib/push'

const email = process.argv[2]
const customBody = process.argv[3]

if (!email) {
  console.error('Usage: tsx --env-file=.env.local scripts/send-test-push.ts <email> [body]')
  process.exit(1)
}

;(async () => {
  const u = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
    .then((r) => r[0])

  if (!u) {
    console.error(`No user with email ${email}`)
    process.exit(1)
  }

  const result = await sendPushToUser(u.id, {
    title: 'Cobb Vault test',
    body: customBody ?? 'Manual test from the CLI.',
    url: '/dashboard',
    tag: 'cli-test',
  })

  console.log(`Sent to ${result.sent}/${result.total} devices. Failed: ${result.failed}. Pruned (dead): ${result.pruned}.`)
})()
