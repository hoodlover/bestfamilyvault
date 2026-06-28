// One-shot: add the missing BoA 8494 Path to Change LLC business
// investment account (from the May 2026 statements we already imported)
// + every domain Lance owns per the four "domains 1-4.png" screenshots.
//
// Idempotent: skips any entry whose title already exists in the same
// category. Dry-run by default. --apply commits.
//
//   npx tsx --env-file=.env.local scripts/seed-domains-and-8494.ts
//   npx tsx --env-file=.env.local scripts/seed-domains-and-8494.ts --apply

import { db } from '@/lib/db'
import { entries, categories, subcategories } from '@/lib/db/schema'
import { eq, and, ilike } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

// ─── Domains from the screenshots ──────────────────────────────────────────
//
// "renews" is the Auto-renews / Expires date shown in the screenshot,
// converted to ISO YYYY-MM-DD. "cost11_25" is the default $11.25 cost.
// Per Lance's rule, these 7 .app domains cost $15 instead.

const FIFTEEN_DOLLAR_DOMAINS = new Set([
  'pathtochange.app',
  'just-prompt-it.app',
  'ailiencode.app',
  'cobbfam.app',
  'hoodlove.app',
  'cobbfamily.app',
  'weekscreek.app',
])

interface DomainRow {
  name: string
  /** ISO YYYY-MM-DD; null for "Third Party" rows that don't show a date. */
  renewsAt: string | null
  /** True if the screenshot showed "Expires" (orange clock) instead of
   *  "Auto-renews" — we still treat it as recurring but flag in the note. */
  expiring?: boolean
  /** True for the bottom 5 "Third Party" entries — no renewal date,
   *  not auto-renewing on this account. We create the entry but skip
   *  isRecurring. */
  thirdParty?: boolean
}

const DOMAINS: DomainRow[] = [
  // domains 1.png
  { name: 'hapagidt.com',           renewsAt: '2027-05-13' },
  { name: 'sirpromptalot.com',      renewsAt: '2027-05-11' },
  { name: 'familysecretsvault.com', renewsAt: '2027-04-30' },
  { name: 'familysecretvault.com',  renewsAt: '2027-04-30' },
  { name: 'ttkwig.com',             renewsAt: '2027-04-29' },
  { name: 'familysectretsvault.com', renewsAt: '2027-04-29' },
  { name: 'imgonevault.com',        renewsAt: '2027-04-29' },
  { name: 'familysectretvault.com', renewsAt: '2027-04-29' },
  // domains 2.png
  { name: 'imgonewhatnow.com',      renewsAt: '2027-04-29' },
  { name: 'bestfamilyvault.com',    renewsAt: '2027-04-29' },
  { name: 'pathtonotes.com',        renewsAt: '2027-04-20', expiring: true },
  { name: 'just-prompt-it.app',     renewsAt: '2027-04-15' },
  { name: 'prompt-this-ai.com',     renewsAt: '2027-04-15' },
  { name: 'prompts-r-us.com',       renewsAt: '2027-04-15' },
  { name: 'getpromptin.com',        renewsAt: '2027-04-15' },
  { name: 'justprompt-it.com',      renewsAt: '2027-04-15' },
  { name: 'building-with-ai.com',   renewsAt: '2027-04-15' },
  { name: 'prompt-it-up.com',       renewsAt: '2027-04-15' },
  // domains 3.png
  { name: 'ai-buildnow.com',        renewsAt: '2027-04-15' },
  { name: 'ailiencode.app',         renewsAt: '2027-04-15' },
  { name: 'hoodswebapps.com',       renewsAt: '2027-04-15' },
  { name: 'thehoodcode.com',        renewsAt: '2027-04-15' },
  { name: 'ailiencode.com',         renewsAt: '2027-04-15' },
  { name: 'cobbfam.app',            renewsAt: '2027-04-10' },
  { name: 'cobbvault.com',          renewsAt: '2027-04-10' },
  { name: 'hoodlove.app',           renewsAt: '2027-04-10' },
  { name: 'pathtochange.app',       renewsAt: '2027-04-10' },
  { name: 'cobbfamily.app',         renewsAt: '2027-04-10' },
  { name: 'weekscreek.app',         renewsAt: '2027-04-10' },
  // domains 4.png
  { name: 'path2invoice.com',       renewsAt: '2027-04-10' },
  { name: 'pathinvoice.com',        renewsAt: '2027-04-10' },
  // Third Party rows — no renewal date shown, managed elsewhere
  { name: 'weekscreek.life',         renewsAt: null, thirdParty: true },
  { name: 'weekscreekhaven.info',    renewsAt: null, thirdParty: true },
  { name: 'weekscreekrental.com',    renewsAt: null, thirdParty: true },
  { name: '421weekscreek.com',       renewsAt: null, thirdParty: true },
  { name: 'weekscreekhaven.com',     renewsAt: null, thirdParty: true },
]

function costCentsFor(name: string): number {
  return FIFTEEN_DOLLAR_DOMAINS.has(name) ? 1500 : 1125
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function getOrCreateSubcategory(args: {
  categoryId: string
  name: string
  slug: string
}): Promise<string> {
  const existing = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, args.categoryId), eq(subcategories.slug, args.slug)))
    .then((r) => r[0])
  if (existing) return existing.id
  if (!APPLY) {
    console.log(`  would CREATE subcategory ${args.name} (${args.slug}) under category ${args.categoryId}`)
    return '<dry-run-new-subcategory-id>'
  }
  const [row] = await db
    .insert(subcategories)
    .values({
      categoryId: args.categoryId,
      name: args.name,
      slug: args.slug,
      icon: null,
      sortOrder: 100,
    })
    .returning({ id: subcategories.id })
  console.log(`  ✅ created subcategory ${args.name}`)
  return row.id
}

async function findUserId(): Promise<string> {
  // Anything we create needs createdBy/updatedBy. Pull the superuser id;
  // single-owner vault so picking the first superuser is fine.
  const [u] = await db.execute<{ id: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { sql: `SELECT id FROM "user" WHERE role = 'superuser' ORDER BY "createdAt" LIMIT 1`, params: [] } as any,
  ) as unknown as Array<{ id: string }>
  if (!u?.id) throw new Error('No superuser found — cannot attribute new entries.')
  return u.id
}

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  // ─── Resolve categories / subcategories ───────────────────────────────
  const finance = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'finance')).then((r) => r[0])
  if (!finance) throw new Error('Finance category not found.')
  const checkingSavings = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, finance.id), eq(subcategories.slug, 'checking-savings')))
    .then((r) => r[0])
  if (!checkingSavings) throw new Error('"Checking & Saving Banks" subcategory not found.')

  // Path to Change LLC tag lives under Receipts → path-to-change.
  const receipts = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'receipts')).then((r) => r[0])
  if (!receipts) throw new Error('Receipts category not found.')
  const ptcLlc = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, receipts.id), eq(subcategories.slug, 'path-to-change')))
    .then((r) => r[0])
  if (!ptcLlc) throw new Error('"Path to Change, LLC" LLC tag not found.')

  // Tech category + Domains subcategory (create if missing).
  const tech = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'entertainment')).then((r) => r[0])
  if (!tech) throw new Error('Tech category not found.')
  const domainsSubId = await getOrCreateSubcategory({
    categoryId: tech.id,
    name: 'Domains',
    slug: 'domains',
  })

  // Need a creator id. Pull any superuser.
  let creatorId = ''
  try {
    // Direct SQL — drizzle's raw sql template is the simplest path here.
    const rows = await import('drizzle-orm').then(({ sql }) =>
      db.execute<{ id: string }>(sql`SELECT id FROM "user" WHERE role = 'superuser' ORDER BY created_at ASC LIMIT 1`),
    )
    // drizzle execute returns { rows } on neon driver, raw array on others
    const arr = (rows as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (rows as unknown as Array<{ id: string }>)
    creatorId = arr?.[0]?.id ?? ''
  } catch (e) {
    console.error('Could not resolve creator user:', e)
    process.exit(1)
  }
  if (!creatorId) throw new Error('No superuser found.')
  void findUserId

  // ─── 1. BoA 8494 account ──────────────────────────────────────────────
  console.log('── BoA Path to Change LLC 8494 (Business Investment) ──')
  const ACCT_TITLE = 'BofA Savings 8494 — Path to Change LLC'
  const existing8494 = await db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.categoryId, finance.id), ilike(entries.title, '%8494%')))
    .then((r) => r[0])

  if (existing8494) {
    console.log(`  ✓ already exists (id ${existing8494.id}) — skipping`)
  } else if (!APPLY) {
    console.log(`  would CREATE: ${ACCT_TITLE}`)
  } else {
    await db.insert(entries).values({
      categoryId: finance.id,
      subcategoryId: checkingSavings.id,
      llcSubcategoryId: ptcLlc.id,
      type: 'bank_account',
      title: ACCT_TITLE,
      bankName: 'Bank of America',
      accountType: 'Business Investment Account',
      // Per statement page 1 (account # 3340 5997 8494). Stored ENCRYPTED
      // because accountNumber is an encrypted field.
      accountNumber: encrypt('3340 5997 8494') ?? '',
      // Routing left blank — Lance can confirm via online banking (BoA
      // Georgia routing for paper/ACH is often 061000052 but I'd rather
      // not guess on a money field).
      cardholderName: 'Path to Change LLC',
      phone: '(888) 287-4637',
      url: 'https://www.bankofamerica.com/smallbusiness/',
      // Most recent ending balance from the May 2026 statement we have.
      currentBalance: 10276019,
      balanceAsOf: new Date('2026-05-31'),
      isPrivate: false,
      isPersonal: false,
      isFavorite: false,
      isRecurring: false,
      createdBy: creatorId,
      updatedBy: creatorId,
    })
    console.log(`  ✅ created: ${ACCT_TITLE}`)
  }

  // ─── 2. Domains ───────────────────────────────────────────────────────
  console.log('\n── Domain entries (Tech > Domains) ──')
  let created = 0
  let skipped = 0
  for (const d of DOMAINS) {
    const title = `Domain: ${d.name}`
    const existing = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.categoryId, tech.id), eq(entries.title, title)))
      .then((r) => r[0])

    if (existing) {
      skipped++
      continue
    }
    const cents = costCentsFor(d.name)
    const noteBits: string[] = []
    if (d.expiring) noteBits.push('NOTE: shows "Expires" not "Auto-renews" — confirm renewal status before the date.')
    if (d.thirdParty) noteBits.push('Third-party managed — no renewal date shown in the registrar list. Confirm who handles renewals.')
    const noteContent = noteBits.length > 0 ? noteBits.join('\n') : null

    if (!APPLY) {
      console.log(`  would CREATE: ${title}  (${d.renewsAt ?? 'no date'}, $${(cents / 100).toFixed(2)}${d.thirdParty ? ', third-party' : ''})`)
      created++
      continue
    }

    await db.insert(entries).values({
      categoryId: tech.id,
      subcategoryId: domainsSubId,
      type: 'login',
      title,
      url: `https://${d.name}`,
      noteContent: noteContent ? encrypt(noteContent) : null,
      isPrivate: false,
      isPersonal: false,
      isFavorite: false,
      isRecurring: !d.thirdParty,
      subscriptionAmountCents: d.thirdParty ? null : cents,
      subscriptionPeriod: d.thirdParty ? null : 'yearly',
      subscriptionRenewsAt: d.renewsAt,
      createdBy: creatorId,
      updatedBy: creatorId,
    })
    created++
  }
  console.log(`\n${created} domain entries ${APPLY ? 'created' : 'would be created'}, ${skipped} already existed.`)

  if (!APPLY) console.log('\nRe-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
