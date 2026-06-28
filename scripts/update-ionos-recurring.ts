// Update domain entries with correct IONOS renewal prices and create
// the missing ones from the Feb 22, 2026 invoice (#202060402246), plus
// add the 3 monthly IONOS services from the June 1, 2026 invoice trio.
//
// All pricing comes directly from the invoices Lance just dropped in
// the Vault File Drop. The CRITICAL fact this script encodes: the
// "Special Offer" lines are INTRO-YEAR DISCOUNTS — the FIRST column
// ("Charges") is what gets billed at renewal. So a .info domain is
// $35/yr at renewal even though Lance paid $1.99 this year.
//
// Dry-run by default. --apply commits. Idempotent on the domain
// updates (matches existing entries by title), idempotent on the
// service creates (skips if a recurring entry with the matching title
// already exists).

import { db } from '@/lib/db'
import { entries, categories, subcategories } from '@/lib/db/schema'
import { and, eq, ilike, sql } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')

// All annual renewal prices from invoice 202060402246 (Feb 22, 2026).
// Renewal dates per invoice line-items. Period 'yearly'.
const DOMAIN_RENEWALS: Array<{
  title: string         // entry title pattern — matches existing "Domain: foo.com" form
  renewalCents: number  // ANNUAL renewal price in cents (NOT intro discount price)
  renewsAt: string      // YYYY-MM-DD — next renewal
}> = [
  { title: 'Domain: weekscreekhaven.online',   renewalCents: 4800, renewsAt: '2027-01-30' },
  { title: 'Domain: weekscreekhaven.com',      renewalCents: 2000, renewsAt: '2027-01-29' },
  { title: 'Domain: weekscreekhaven.store',    renewalCents: 8400, renewsAt: '2027-01-30' },
  { title: 'Domain: weekscreekhaven.info',     renewalCents: 3500, renewsAt: '2027-01-29' },
  { title: 'Domain: weekscreek.life',          renewalCents: 5300, renewsAt: '2027-01-30' },
  { title: 'Domain: weekscreekcabin.com',      renewalCents: 2000, renewsAt: '2027-02-02' },
  { title: 'Domain: cobbfamilysolutions.com',  renewalCents: 2000, renewsAt: '2027-02-02' },
  { title: 'Domain: cobb-family.info',         renewalCents: 3500, renewsAt: '2027-02-02' },
  { title: 'Domain: 421weekscreek.com',        renewalCents: 2000, renewsAt: '2027-02-02' },
  { title: 'Domain: weekscreekrental.com',     renewalCents: 2000, renewsAt: '2027-02-02' },
]

// Domain Guard is a WHOIS-privacy addon, not a domain — gets its own entry.
const DOMAIN_GUARD = {
  title: 'IONOS Domain Guard (WHOIS privacy)',
  renewalCents: 1500,
  renewsAt: '2027-01-29',
}

// Monthly services from the June 1, 2026 invoice trio. These bill
// $/month, not $/year, so the recurring math is very different.
const MONTHLY_SERVICES: Array<{
  title: string
  monthlyCents: number
  contractId: string  // for the notes field — useful when Lance calls IONOS to cancel
}> = [
  { title: 'IONOS MyWebsite Now Starter', monthlyCents: 1800, contractId: '110374640' },
  { title: 'IONOS rankingCoach Advanced', monthlyCents: 3000, contractId: '110374638' },
  { title: 'IONOS Email Marketing Plus',  monthlyCents: 1500, contractId: '110374636' },
]

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.\n' : '🔍 Dry-run — pass --apply to write.\n')

  // Resolve Tech category (slug is "entertainment" for historical reasons).
  const tech = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'entertainment')).then((r) => r[0])
  if (!tech) throw new Error('Tech category (slug=entertainment) not found.')

  const domainsSub = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, tech.id), eq(subcategories.slug, 'domains'))).then((r) => r[0])
  if (!domainsSub) throw new Error('Tech > Domains subcategory not found.')

  // Resolve a creator id (any superuser) for the new service entries.
  const userRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM "user" WHERE role = 'superuser' ORDER BY created_at ASC LIMIT 1`,
  )
  const arr = (userRows as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (userRows as unknown as Array<{ id: string }>)
  const creatorId = arr?.[0]?.id ?? ''
  if (!creatorId) throw new Error('No superuser found.')

  // ─── Update existing + create missing domain entries ──────────────────────

  console.log('━━━ Domain entries (annual renewal pricing) ━━━')
  let domainUpdates = 0
  let domainCreates = 0

  for (const d of DOMAIN_RENEWALS) {
    const existing = await db.select({ id: entries.id, isRecurring: entries.isRecurring, subscriptionAmountCents: entries.subscriptionAmountCents })
      .from(entries).where(ilike(entries.title, d.title)).then((r) => r[0])

    if (existing) {
      const before = `$${(existing.subscriptionAmountCents ?? 0) / 100}`
      const after = `$${d.renewalCents / 100}`
      if (existing.subscriptionAmountCents === d.renewalCents && existing.isRecurring) {
        console.log(`  ✓ ${d.title} — already at ${after}/yr, skipping`)
        continue
      }
      console.log(`  ${APPLY ? '✏️ ' : 'would update'} ${d.title}: ${before} → ${after}/yr (renews ${d.renewsAt})`)
      if (APPLY) {
        await db.update(entries).set({
          isRecurring: true,
          subscriptionAmountCents: d.renewalCents,
          subscriptionPeriod: 'yearly',
          subscriptionRenewsAt: d.renewsAt,
        }).where(eq(entries.id, existing.id))
      }
      domainUpdates++
    } else {
      console.log(`  ${APPLY ? '➕ ' : 'would create'} ${d.title} @ $${d.renewalCents / 100}/yr (renews ${d.renewsAt})`)
      if (APPLY) {
        await db.insert(entries).values({
          categoryId: tech.id,
          subcategoryId: domainsSub.id,
          type: 'login',
          title: d.title,
          url: `https://${d.title.replace(/^Domain:\s*/, '')}`,
          isRecurring: true,
          subscriptionAmountCents: d.renewalCents,
          subscriptionPeriod: 'yearly',
          subscriptionRenewsAt: d.renewsAt,
          isPrivate: false,
          isPersonal: false,
          isFavorite: false,
          createdBy: creatorId,
          updatedBy: creatorId,
        })
      }
      domainCreates++
    }
  }

  // ─── Domain Guard (addon, not a domain) ───────────────────────────────────

  console.log('\n━━━ Domain Guard addon ━━━')
  const dgExisting = await db.select({ id: entries.id })
    .from(entries).where(ilike(entries.title, '%domain guard%')).then((r) => r[0])
  if (dgExisting) {
    console.log(`  ✓ Already exists (id ${dgExisting.id}) — skipping`)
  } else {
    console.log(`  ${APPLY ? '➕ ' : 'would create'} ${DOMAIN_GUARD.title} @ $${DOMAIN_GUARD.renewalCents / 100}/yr`)
    if (APPLY) {
      await db.insert(entries).values({
        categoryId: tech.id,
        subcategoryId: domainsSub.id,
        type: 'login',
        title: DOMAIN_GUARD.title,
        isRecurring: true,
        subscriptionAmountCents: DOMAIN_GUARD.renewalCents,
        subscriptionPeriod: 'yearly',
        subscriptionRenewsAt: DOMAIN_GUARD.renewsAt,
        isPrivate: false,
        isPersonal: false,
        isFavorite: false,
        createdBy: creatorId,
        updatedBy: creatorId,
      })
    }
  }

  // ─── Monthly services ─────────────────────────────────────────────────────

  console.log('\n━━━ Monthly IONOS services ━━━')
  let serviceCreates = 0
  for (const s of MONTHLY_SERVICES) {
    const existing = await db.select({ id: entries.id, subscriptionAmountCents: entries.subscriptionAmountCents })
      .from(entries).where(ilike(entries.title, s.title)).then((r) => r[0])
    if (existing) {
      console.log(`  ✓ Already exists: ${s.title} ($${(existing.subscriptionAmountCents ?? 0) / 100}/mo) — skipping`)
      continue
    }
    console.log(`  ${APPLY ? '➕ ' : 'would create'} ${s.title} @ $${s.monthlyCents / 100}/mo (contract ${s.contractId})`)
    if (APPLY) {
      await db.insert(entries).values({
        categoryId: tech.id,
        subcategoryId: domainsSub.id, // closest fit; Lance can re-file
        type: 'login',
        title: s.title,
        url: 'https://my.ionos.com',
        // Contract ID goes in noteContent so it's there when he needs to
        // call IONOS to downgrade/cancel — they always ask for it.
        noteContent: `IONOS Contract ID: ${s.contractId}\nBilled monthly; renews automatically. Cancel via my.ionos.com or 1-484-254-5555.`,
        isRecurring: true,
        subscriptionAmountCents: s.monthlyCents,
        subscriptionPeriod: 'monthly',
        isPrivate: false,
        isPersonal: false,
        isFavorite: false,
        createdBy: creatorId,
        updatedBy: creatorId,
      })
    }
    serviceCreates++
  }

  console.log(`\n━━━ Summary ━━━`)
  console.log(`  Domain updates:  ${domainUpdates}`)
  console.log(`  Domain creates:  ${domainCreates}`)
  console.log(`  Service creates: ${serviceCreates}`)

  // Total annual IONOS spend for these renewals
  const annualDomainTotal = DOMAIN_RENEWALS.reduce((sum, d) => sum + d.renewalCents, 0) + DOMAIN_GUARD.renewalCents
  const annualServiceTotal = MONTHLY_SERVICES.reduce((sum, s) => sum + s.monthlyCents * 12, 0)
  console.log(`\n  Annual IONOS spend (these items only):`)
  console.log(`    Domain renewals + Domain Guard: $${(annualDomainTotal / 100).toFixed(2)}`)
  console.log(`    Monthly services × 12:          $${(annualServiceTotal / 100).toFixed(2)}`)
  console.log(`    TOTAL:                          $${((annualDomainTotal + annualServiceTotal) / 100).toFixed(2)}/year`)

  if (!APPLY) console.log('\nRe-run with --apply to write.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
