// Drop a single "IONOS Domains & Services" note into the vault that
// summarizes everything I found in Lance's invoices — total spend,
// renewal calendar, monthly services, contract IDs, and a candid
// "what to actually do about this" recommendations section.
//
// Lives under Tech > Domains alongside the individual domain entries
// so it's easy to find. noteContent is encrypted at rest. Idempotent:
// updates the existing note in place if re-run.

import { db } from '@/lib/db'
import { entries, categories, subcategories } from '@/lib/db/schema'
import { and, eq, ilike } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

const NOTE_TITLE = 'IONOS Domains & Services — pricing, recommendations'

const NOTE_BODY = `IONOS — Domains & Services
===========================
Findings from Feb 22, 2026 invoice (#202060402246) + June 1, 2026
monthly invoices. Customer ID 564107544. Phone 1-484-254-5555.

TL;DR — TOTAL ANNUAL IONOS SPEND
--------------------------------
$1,141/year (~$95/month) once intro discounts expire.
  - $370/yr — 10 domain renewals + Domain Guard addon
  - $216/yr — MyWebsite Now Starter ($18/mo)
  - $360/yr — rankingCoach Advanced ($30/mo) ← biggest line item
  - $180/yr — Email Marketing Plus ($15/mo)
  - $15/yr  — Domain Guard (WHOIS privacy)

The Feb 2026 invoice showed only $54.59 because every domain had a
big "Special Offer" intro-year discount. The real bill hits in late
Jan / early Feb 2027.

DOMAIN RENEWAL CALENDAR (2027)
------------------------------
All annual. Sorted by renewal date.

Jan 29, 2027
  weekscreekhaven.com .............. $20
  weekscreekhaven.info ............. $35
  Domain Guard (addon) ............. $15

Jan 30, 2027
  weekscreekhaven.online ........... $48
  weekscreekhaven.store ............ $84  ← .store is expensive
  weekscreek.life .................. $53

Feb  2, 2027
  weekscreekcabin.com .............. $20
  cobbfamilysolutions.com .......... $20
  cobb-family.info ................. $35
  421weekscreek.com ................ $20
  weekscreekrental.com ............. $20

MONTHLY SERVICES (bill every month)
-----------------------------------
Contract IDs included — IONOS asks for these every time you call.

  MyWebsite Now Starter ............ $18/mo .... contract 110374640
  rankingCoach Advanced ............ $30/mo .... contract 110374638
  Email Marketing Plus ............. $15/mo .... contract 110374636

To cancel any: my.ionos.com → Contracts → pick contract → Cancel.
Or call 1-484-254-5555 with the contract ID ready.

RECOMMENDATIONS
---------------
1. rankingCoach Advanced ($360/yr) is the single biggest line item.
   This is an SEO tool. Honest question: is anyone actually using
   it? If the answer is "I signed up to try it and forgot" — kill it
   first. Highest ROI cancel on the list.

2. .store domain (weekscreekhaven.store, $84/yr) is 4x more expensive
   than the .com equivalents. If the .com is the real site, drop the
   .store. .store and .online together = $132/yr of brand-protection
   spend that may or may not be worth it.

3. weekscreekhaven cluster is FIVE TLDs of the same name: .com .info
   .online .store .life — that's $240/yr just for "nobody else can
   squat on weekscreekhaven." Keep .com + maybe one fallback; drop
   the rest unless you have a concrete plan for them.

4. The 421weekscreek.com / weekscreekrental.com / weekscreekcabin.com
   trio is $60/yr. Each one points at the cabin business. If only one
   is the canonical URL, the other two are pure squatting prevention.

5. The .app domains (pathtochange.app, ailiencode.app, cobbfam.app,
   cobbfamily.app, hoodlove.app, just-prompt-it.app, weekscreek.app)
   are tracked at $15/yr in the vault — that's what you specified at
   purchase. Real .app renewal pricing is typically $14-20/yr at
   IONOS so the estimate should hold, BUT it's not invoice-verified.
   Drop the .app renewal invoice in the vault when you get it and we
   can lock the exact number.

6. Email Marketing Plus at $15/mo is reasonable if you actually use
   it for path-to-change campaigns. If it's been dormant for months,
   the per-send cost works out to "way too much" — check usage in
   my.ionos.com.

WHAT I COULDN'T FIND IN THESE INVOICES
--------------------------------------
- .app domain renewal pricing (no .app invoice was dropped)
- Hosting tier for any non-MyWebsite-Now domain
- Mailbox / email account pricing if separate from Email Marketing
- Any one-time setup fees from initial purchase

If you have any of these in your IONOS account, drop the invoices in
the Vault File Drop and I'll add them.

AGGRESSIVE-CUT SCENARIO
-----------------------
If you wanted to slash the annual spend to the bone:
  - Cancel rankingCoach ........................ -$360/yr
  - Cancel Email Marketing (if unused) ......... -$180/yr
  - Drop weekscreekhaven .store .online .info .. -$167/yr
  - Drop two of the cabin .com variants ........ -$40/yr
  - TOTAL SAVED ................................ -$747/yr
  - New annual IONOS spend ..................... ~$394/yr

That's a ~65% reduction without touching anything that matters.

CONTACT INFO
------------
Phone:    1-484-254-5555 (24/7)
Web:      my.ionos.com/invoices
Customer: 564107544
Billing:  Charged to credit card on file ~2 days after invoice date

This note was generated 2026-06-08 by reviewing invoices in the
Vault File Drop. Re-generate this from scripts/add-ionos-notes.ts
when new invoices come in.
`

async function main() {
  console.log(APPLY ? '🟢 APPLY mode\n' : '🔍 Dry-run — pass --apply to write.\n')

  // Same Tech > Domains placement as the individual domain entries,
  // so this note is right next to the things it documents.
  const tech = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'entertainment')).then((r) => r[0])
  if (!tech) throw new Error('Tech category not found.')
  const domainsSub = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, tech.id), eq(subcategories.slug, 'domains'))).then((r) => r[0])
  if (!domainsSub) throw new Error('Tech > Domains subcategory not found.')

  const { sql } = await import('drizzle-orm')
  const userRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM "user" WHERE role = 'superuser' ORDER BY created_at ASC LIMIT 1`,
  )
  const arr = (userRows as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (userRows as unknown as Array<{ id: string }>)
  const creatorId = arr?.[0]?.id ?? ''
  if (!creatorId) throw new Error('No superuser found.')

  // Idempotent: update in place if it already exists.
  const existing = await db.select({ id: entries.id }).from(entries)
    .where(and(eq(entries.categoryId, tech.id), ilike(entries.title, NOTE_TITLE))).then((r) => r[0])

  const encrypted = encrypt(NOTE_BODY) ?? ''

  if (existing) {
    console.log(`✓ Note already exists (id ${existing.id}) — ${APPLY ? 'updating in place' : 'would update in place'}`)
    if (APPLY) {
      await db.update(entries).set({
        noteContent: encrypted,
        updatedBy: creatorId,
      }).where(eq(entries.id, existing.id))
    }
  } else {
    console.log(`➕ ${APPLY ? 'creating' : 'would create'} note: "${NOTE_TITLE}"`)
    console.log(`   under Tech > Domains, ${NOTE_BODY.length} chars`)
    if (APPLY) {
      await db.insert(entries).values({
        categoryId: tech.id,
        subcategoryId: domainsSub.id,
        type: 'note',
        title: NOTE_TITLE,
        noteContent: encrypted,
        isPrivate: false,
        isPersonal: false,
        isFavorite: true,  // pin it on the dashboard so it's easy to find
        isRecurring: false,
        createdBy: creatorId,
        updatedBy: creatorId,
      })
    }
  }

  if (!APPLY) console.log('\nRe-run with --apply to write.')
  else console.log('\n✅ Done. Find it on /dashboard under favorites, or Tech > Domains.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
