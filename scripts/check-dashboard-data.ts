import { db } from '@/lib/db'
import { entries, notes, letters } from '@/lib/db/schema'
import { sql, isNotNull } from 'drizzle-orm'

async function main() {
  const today = new Date()
  const month = today.getMonth() + 1
  const day = today.getDate()

  console.log(`Today: ${month}/${day}`)

  const eMatch = await db.select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(sql`extract(month from ${entries.createdAt}) = ${month} AND extract(day from ${entries.createdAt}) = ${day} AND extract(year from ${entries.createdAt}) < ${today.getFullYear()}`)
  console.log(`Entries on this day (prior years): ${eMatch[0].count}`)

  const nMatch = await db.select({ count: sql<number>`count(*)::int` })
    .from(notes)
    .where(sql`extract(month from ${notes.createdAt}) = ${month} AND extract(day from ${notes.createdAt}) = ${day} AND extract(year from ${notes.createdAt}) < ${today.getFullYear()}`)
  console.log(`Notes on this day (prior years): ${nMatch[0].count}`)

  const lMatch = await db.select({ count: sql<number>`count(*)::int` })
    .from(letters)
    .where(sql`extract(month from ${letters.createdAt}) = ${month} AND extract(day from ${letters.createdAt}) = ${day} AND extract(year from ${letters.createdAt}) < ${today.getFullYear()}`)
  console.log(`Letters on this day (prior years): ${lMatch[0].count}`)

  const eEarliest = await db.select({ d: sql<Date>`min(${entries.createdAt})` }).from(entries)
  const nEarliest = await db.select({ d: sql<Date>`min(${notes.createdAt})` }).from(notes)
  console.log(`Earliest entry createdAt: ${eEarliest[0].d}`)
  console.log(`Earliest note createdAt: ${nEarliest[0].d}`)

  const nw = await db.select({ count: sql<number>`count(*)::int` })
    .from(entries)
    .where(isNotNull(entries.currentBalance))
  console.log(`Entries with currentBalance set: ${nw[0].count}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
