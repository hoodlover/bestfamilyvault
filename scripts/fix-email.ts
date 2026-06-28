import { db } from '../src/lib/db/index'
import { users } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

async function main() {
  await db.update(users).set({ email: 'lance.climb@gmail.com' }).where(eq(users.role, 'superuser'))
  console.log('Done!')
}

main().then(() => process.exit(0)).catch(console.error)
