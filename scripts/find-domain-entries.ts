// Narrow search — only look for the exact domains we're about to add
// from the screenshots, so we can match-or-create cleanly.

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { ilike, or } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'

const DOMAINS = [
  'hapagidt.com', 'sirpromptalot.com', 'familysecretsvault.com',
  'familysecretvault.com', 'ttkwig.com', 'familysectretsvault.com',
  'imgonevault.com', 'familysectretvault.com', 'imgonewhatnow.com',
  'bestfamilyvault.com', 'pathtonotes.com', 'just-prompt-it.app',
  'prompt-this-ai.com', 'prompts-r-us.com', 'getpromptin.com',
  'justprompt-it.com', 'building-with-ai.com', 'prompt-it-up.com',
  'ai-buildnow.com', 'ailiencode.app', 'hoodswebapps.com',
  'thehoodcode.com', 'ailiencode.com', 'cobbfam.app', 'cobbvault.com',
  'hoodlove.app', 'pathtochange.app', 'cobbfamily.app', 'weekscreek.app',
  'path2invoice.com', 'pathinvoice.com', 'weekscreek.life',
  'weekscreekhaven.info', 'weekscreekrental.com', '421weekscreek.com',
  'weekscreekhaven.com',
]

;(async () => {
  // Build OR-of-ilike across both title and url for each candidate.
  const matchers = DOMAINS.flatMap((d) => [
    ilike(entries.title, `%${d}%`),
    ilike(entries.url, `%${d}%`),
  ])
  const rows = await db.select().from(entries).where(or(...matchers))
  const decrypted = decryptEntries(rows)

  // Build a per-domain summary so we know match vs miss.
  console.log(`Checking ${DOMAINS.length} domains against ${decrypted.length} candidate entries.\n`)
  let hit = 0
  let miss = 0
  for (const d of DOMAINS) {
    const matches = decrypted.filter(
      (e) =>
        e.title?.toLowerCase().includes(d.toLowerCase()) ||
        e.url?.toLowerCase().includes(d.toLowerCase()),
    )
    if (matches.length === 0) {
      console.log(`  ❌ ${d}  — no existing entry`)
      miss++
    } else {
      hit++
      for (const m of matches) {
        console.log(`  ✓  ${d}  ← "${m.title}"  [${m.type}, recurring=${m.isRecurring}]`)
      }
    }
  }
  console.log(`\n${hit}/${DOMAINS.length} domains already have at least one entry; ${miss} need creating.`)
  process.exit(0)
})()
