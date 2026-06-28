import { db } from '../src/lib/db/index'
import { users } from '../src/lib/db/schema'

async function main() {
  const all = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
  console.log(all)
}

main().then(() => process.exit(0)).catch(console.error)
