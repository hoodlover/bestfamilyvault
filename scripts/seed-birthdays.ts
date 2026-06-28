// One-shot seed for the family's birthdays. Matches users by first name
// (case-insensitive), updates dateOfBirth. Idempotent — run as many times
// as you want.
//
//   npx tsx --env-file=.env.local scripts/seed-birthdays.ts
//
// Lance's own birthday isn't in here yet — fill it in from
// Settings → Profile when you sign in, or add a row below and re-run.

import { eq, ilike } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { users } from '../src/lib/db/schema'

interface Birthday {
  firstName: string
  // YYYY-MM-DD in local time (we store at midnight UTC; only month/day matter
  // for the dashboard banner so the year is for "X years old today" math).
  date: string
}

const BIRTHDAYS: Birthday[] = [
  { firstName: 'Heather',  date: '1972-12-05' },
  { firstName: 'Tadan',    date: '1998-07-16' },
  { firstName: 'Sydney',   date: '2001-09-21' },
  { firstName: 'Makenzie', date: '2006-01-09' },
  { firstName: 'Paiton',   date: '2007-12-17' },
]

async function main() {
  let ok = 0, skip = 0
  for (const b of BIRTHDAYS) {
    // Match by first name in `name` column. Case-insensitive prefix match
    // so "Heather Cobb" / "heather" / "Heather" all hit.
    const matches = await db.select().from(users).where(ilike(users.name, `${b.firstName}%`))
    if (matches.length === 0) {
      console.warn(`  ! no user found for "${b.firstName}" — skipped`)
      skip++
      continue
    }
    if (matches.length > 1) {
      console.warn(`  ! multiple users matched "${b.firstName}" (${matches.map(m => m.name).join(', ')}) — skipped`)
      skip++
      continue
    }
    const u = matches[0]
    const dob = new Date(b.date + 'T00:00:00Z')
    await db.update(users).set({ dateOfBirth: dob, updatedAt: new Date() }).where(eq(users.id, u.id))
    console.log(`  ✓ ${u.name ?? u.email}: ${b.date}`)
    ok++
  }
  console.log()
  console.log(`Updated ${ok}, skipped ${skip}.`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
