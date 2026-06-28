// Find every login entry whose username is a Lance shorthand ('l',
// 'c', 'l.c', 'lc', 'l.cobb', 'lance', etc.) and replace it with
// lance.climb@gmail.com.
//
// Dry-run by default. --apply commits.
//
//   npx tsx --env-file=.env.local scripts/fix-shorthand-usernames.ts
//   npx tsx --env-file=.env.local scripts/fix-shorthand-usernames.ts --apply

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')
const TARGET = 'lance.climb@gmail.com'

// Normalize a username for comparison by stripping dots, spaces, and
// case. That way "l.c", "l. c", "L. c", "l . c", "L.C" all collapse
// to "lc" and we can match them with one set entry. Same trick for
// "lance.c" / "Lance . c".
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[.\s]+/g, '')
}

// Normalized forms we want rewritten to lance.climb@gmail.com. Strictly
// Lance shorthand — "Lance Cobb" (full name) collapses to "lancecobb"
// and is NOT in this set, because those may be intentional display-name
// values on services like Influitive / TaxBandits.
const SHORTHANDS = new Set([
  'l',
  'c',
  'lc',       // matches l.c, l. c, L.C, l . c, etc.
  'lancec',   // matches lance.c, Lance. c
])

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  const rows = await db.select().from(entries).where(eq(entries.type, 'login'))
  const decrypted = decryptEntries(rows)

  const candidates = decrypted.filter((e) => {
    if (!e.username) return false
    return SHORTHANDS.has(normalize(e.username))
  })

  if (candidates.length === 0) {
    console.log('No shorthand usernames found. Nothing to do.')
    return
  }

  console.log(`Found ${candidates.length} login(s) with a Lance shorthand username:\n`)
  for (const e of candidates) {
    console.log(`  "${e.title}"  username "${e.username}"  →  ${TARGET}`)
    if (APPLY) {
      await db.update(entries).set({ username: TARGET }).where(eq(entries.id, e.id))
    }
  }
  console.log(`\n${candidates.length} ${APPLY ? 'updated' : 'would update'}.`)
  if (!APPLY) console.log('Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
