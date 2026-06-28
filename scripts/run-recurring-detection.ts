// Manual trigger for the recurring-charge detector outside the
// weekly cron — useful right after a big backfill to see what
// patterns turn up. Iterates every user, detects, dedupes against
// existing isRecurring entries, upserts suggestions.

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, recurringSuggestions, subcategories } from '@/lib/db/schema'
import {
  detectRecurringForUser,
  filterAlreadyTracked,
  upsertRecurringSuggestions,
} from '@/lib/recurring-detect'

;(async () => {
  const allUsers = await db.select({ id: users.id, email: users.email }).from(users)

  for (const u of allUsers) {
    const candidates = await detectRecurringForUser(u.id)
    if (candidates.length === 0) continue
    const novel = await filterAlreadyTracked(u.id, candidates)
    const { inserted, updated } = await upsertRecurringSuggestions(u.id, novel)
    console.log(
      `${u.email ?? u.id}: ${candidates.length} candidates · ${novel.length} novel · ${inserted} inserted · ${updated} updated`,
    )

    // Show what's pending in the queue right now, grouped by LLC tag.
    const pending = await db
      .select({
        merchant: recurringSuggestions.displayName,
        amount: recurringSuggestions.typicalAmountCents,
        period: recurringSuggestions.period,
        occ: recurringSuggestions.occurrenceCount,
        nextAt: recurringSuggestions.predictedNextAt,
        llcName: subcategories.name,
      })
      .from(recurringSuggestions)
      .leftJoin(subcategories, eq(subcategories.id, recurringSuggestions.llcSubcategoryId))
      .where(eq(recurringSuggestions.userId, u.id))

    if (pending.length === 0) continue
    console.log(`\n  Pending suggestions for ${u.email}:`)
    const byLlc = new Map<string, typeof pending>()
    for (const p of pending) {
      const k = p.llcName ?? '(personal)'
      const arr = byLlc.get(k) ?? []
      arr.push(p)
      byLlc.set(k, arr)
    }
    for (const [llc, rows] of byLlc) {
      console.log(`  ─── ${llc} ───`)
      rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      for (const r of rows) {
        const amt = `$${(Math.abs(r.amount) / 100).toFixed(2)}/${r.period === 'monthly' ? 'mo' : 'yr'}`
        console.log(`    ${amt.padEnd(14)} ${r.occ}×  next ~${r.nextAt}  ${r.merchant}`)
      }
    }
  }
})()
