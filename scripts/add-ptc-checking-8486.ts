// Add the Path to Change LLC Bank of America Business Advantage
// Fundamentals Banking checking account (3340 5997 8486) so the next
// `npm run import:inbox` has a target to match against. Mirrors the
// savings-8494 addition; populates all fields available from the
// imported May 2026 statement.
//
// Idempotent: skips if a Finance entry with "8486" in the title already
// exists. Dry-run by default. --apply commits.

import { db } from '@/lib/db'
import { entries, categories, subcategories } from '@/lib/db/schema'
import { eq, and, ilike } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.\n')

  // Resolve category / subcategory / LLC tag the same way the savings
  // 8494 seed did, so this entry lands in the same place.
  const finance = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'finance')).then((r) => r[0])
  if (!finance) throw new Error('Finance category not found.')
  const checkingSavings = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, finance.id), eq(subcategories.slug, 'checking-savings')))
    .then((r) => r[0])
  if (!checkingSavings) throw new Error('"Checking & Saving Banks" subcategory not found.')

  const receipts = await db.select({ id: categories.id }).from(categories)
    .where(eq(categories.slug, 'receipts')).then((r) => r[0])
  if (!receipts) throw new Error('Receipts category not found.')
  const ptcLlc = await db.select({ id: subcategories.id }).from(subcategories)
    .where(and(eq(subcategories.categoryId, receipts.id), eq(subcategories.slug, 'path-to-change')))
    .then((r) => r[0])
  if (!ptcLlc) throw new Error('"Path to Change, LLC" LLC tag not found.')

  // Resolve creator id (any superuser).
  const { sql } = await import('drizzle-orm')
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM "user" WHERE role = 'superuser' ORDER BY created_at ASC LIMIT 1`,
  )
  const arr = (rows as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (rows as unknown as Array<{ id: string }>)
  const creatorId = arr?.[0]?.id ?? ''
  if (!creatorId) throw new Error('No superuser found.')

  // Dedup check — if a finance entry with 8486 in the title already
  // exists, skip cleanly.
  const ACCT_TITLE = 'BofA Checking 8486 — Path to Change LLC'
  const existing = await db
    .select({ id: entries.id, title: entries.title })
    .from(entries)
    .where(and(eq(entries.categoryId, finance.id), ilike(entries.title, '%8486%')))
    .then((r) => r[0])

  if (existing) {
    console.log(`✓ already exists: "${existing.title}" (id ${existing.id}) — skipping`)
    return
  }

  if (!APPLY) {
    console.log(`would CREATE: ${ACCT_TITLE}`)
    console.log('  bank: Bank of America')
    console.log('  type: Business Advantage Fundamentals Banking (Checking)')
    console.log('  account#: 3340 5997 8486')
    console.log('  phone: (888) 287-4637')
    console.log('  url: https://www.bankofamerica.com/smallbusiness/')
    console.log('  currentBalance: $46,827.86 as of 2026-05-31')
    console.log('  LLC tag: Path to Change')
    console.log('\nRe-run with --apply to write.')
    return
  }

  await db.insert(entries).values({
    categoryId: finance.id,
    subcategoryId: checkingSavings.id,
    llcSubcategoryId: ptcLlc.id,
    type: 'bank_account',
    title: ACCT_TITLE,
    bankName: 'Bank of America',
    // Business Advantage Fundamentals Banking is BoA's flagship small-
    // business checking — record it as "Checking" so the LLC dashboards
    // group it correctly.
    accountType: 'Business Advantage Fundamentals Checking',
    // Encrypted at rest like every other accountNumber.
    accountNumber: encrypt('3340 5997 8486') ?? '',
    cardholderName: 'Path to Change LLC',
    // 1-888-BUSINESS — the BoA small-business line, NOT the personal
    // 800-432-1000 number (already on the personal 0202 / 0695 entries).
    phone: '(888) 287-4637',
    url: 'https://www.bankofamerica.com/smallbusiness/',
    // Most recent ending balance from the May 2026 statement.
    currentBalance: 4682786,
    balanceAsOf: new Date('2026-05-31'),
    isPrivate: false,
    isPersonal: false,
    isFavorite: false,
    isRecurring: false,
    createdBy: creatorId,
    updatedBy: creatorId,
  })

  console.log(`✅ created: ${ACCT_TITLE}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
