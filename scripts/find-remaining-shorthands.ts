// Sanity sweep — list every login username that's 4 chars or less,
// or matches "l. c"/"l  c"/etc. variants we may have missed. Read-only.

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'

;(async () => {
  const rows = await db.select().from(entries).where(eq(entries.type, 'login'))
  const decrypted = decryptEntries(rows)

  // Buckets:
  //   short: usernames <=4 chars after trim
  //   spaced: usernames matching /^l[. ]+c$/i
  //   suspicious: starts with "l" or "c" and 1-6 chars total
  const short: Array<{ title: string; username: string }> = []
  const spaced: Array<{ title: string; username: string }> = []

  for (const e of decrypted) {
    if (!e.username) continue
    const u = e.username.trim()
    if (u.length <= 4) short.push({ title: e.title, username: u })
    if (/^l[.\s]+c$/i.test(u)) spaced.push({ title: e.title, username: u })
  }

  console.log(`SHORT usernames (≤4 chars):  ${short.length}\n`)
  for (const s of short) console.log(`  "${s.username}"  ← ${s.title}`)
  console.log(`\nSPACED L. c / L .c variants:  ${spaced.length}\n`)
  for (const s of spaced) console.log(`  "${s.username}"  ← ${s.title}`)
  process.exit(0)
})()
