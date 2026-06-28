// Pre-creates the 5 Bluevine sub-account entries Lance told me about
// on 2026-06-07 so the auto-importer can match incoming statements
// to them by institution ("Bluevine") + last-4. Without these
// entries, every Bluevine statement Claude classifies would land in
// REVIEW.txt because findMatchingEntry has nothing to attach to.
//
// Bluevine actually has 7 sub-accounts; only the 5 Lance routes
// through to specific LLCs / personal use cases are seeded here.
// Add the remaining 2 to ACCOUNTS below and re-run when their
// purpose is decided.
//
// Mapping (last-4 → LLC):
//   9058 → Place of Grace LLC
//   6242 → PTC Havens LLC
//   6628 → H&L Havens LLC
//   8845 → H&L Havens LLC
//   6259 → Personal (Home Improvements)  ← no LLC tag
//
// Idempotent: skips any (institution, last-4) pair already present
// in the vault. Safe to re-run.

import { and, eq, ilike } from 'drizzle-orm'
import { db } from '@/lib/db'
import { categories, subcategories, entries, users } from '@/lib/db/schema'

interface BluevineAccount {
  last4: string
  llcSubcategorySlug: string | null  // null = personal
  purpose: string
}

const ACCOUNTS: BluevineAccount[] = [
  { last4: '9058', llcSubcategorySlug: 'place-of-grace', purpose: 'Place of Grace LLC' },
  { last4: '6242', llcSubcategorySlug: 'ptc-havens',     purpose: 'PTC Havens LLC' },
  { last4: '6628', llcSubcategorySlug: 'hl-havens',      purpose: 'H&L Havens LLC' },
  { last4: '8845', llcSubcategorySlug: 'hl-havens',      purpose: 'H&L Havens LLC' },
  { last4: '6259', llcSubcategorySlug: null,             purpose: 'Personal — Home Improvements' },
]

;(async () => {
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'lance.climb@gmail.com'))
    .limit(1)
    .then((r) => r[0])
  if (!owner) throw new Error('Owner user not found')

  const finance = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'finance'))
    .limit(1)
    .then((r) => r[0])
  if (!finance) throw new Error('Finance category not found')

  const checking = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, finance.id), eq(subcategories.slug, 'checking-savings')))
    .limit(1)
    .then((r) => r[0])
  if (!checking) throw new Error('Finance > Checking & Saving Banks not found')

  // Resolve LLC subcategory ids up front so a typo'd slug fails loudly
  // before any inserts happen.
  const llcIdBySlug = new Map<string, string>()
  for (const a of ACCOUNTS) {
    if (!a.llcSubcategorySlug || llcIdBySlug.has(a.llcSubcategorySlug)) continue
    const sub = await db
      .select({ id: subcategories.id })
      .from(subcategories)
      .innerJoin(categories, eq(categories.id, subcategories.categoryId))
      .where(and(eq(categories.slug, 'receipts'), eq(subcategories.slug, a.llcSubcategorySlug)))
      .limit(1)
      .then((r) => r[0])
    if (!sub) throw new Error(`Receipts > ${a.llcSubcategorySlug} LLC subcategory not found`)
    llcIdBySlug.set(a.llcSubcategorySlug, sub.id)
  }

  let created = 0
  let skipped = 0

  for (const a of ACCOUNTS) {
    // Idempotency: skip if an entry with this institution + last-4 already
    // exists. Mirrors findMatchingEntry's signal weighting (last-4 is the
    // strongest identifier).
    const existing = await db
      .select({ id: entries.id, title: entries.title })
      .from(entries)
      .where(
        and(
          eq(entries.type, 'bank_account'),
          ilike(entries.title, '%Bluevine%'),
          ilike(entries.title, `%${a.last4}%`),
        ),
      )
      .limit(1)
      .then((r) => r[0])

    if (existing) {
      console.log(`  · skip ${a.last4} — already exists: "${existing.title}"`)
      skipped++
      continue
    }

    const llcId = a.llcSubcategorySlug ? llcIdBySlug.get(a.llcSubcategorySlug) ?? null : null
    const title = `Bluevine Checking ${a.last4} — ${a.purpose}`

    const [row] = await db
      .insert(entries)
      .values({
        categoryId: finance.id,
        subcategoryId: checking.id,
        llcSubcategoryId: llcId,
        type: 'bank_account',
        title,
        bankName: 'Bluevine',
        accountType: 'Checking',
        noteContent:
          `Bluevine sub-account ending in ${a.last4}. Statements dropped into Vault File Drop\\` +
          ` are matched to this entry by import-inbox.ts on institution + last-4.`,
        isFavorite: false,
        isRecurring: false,
        isPrivate: false,
        isPersonal: false,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      .returning({ id: entries.id })

    const tagLabel = llcId ? a.llcSubcategorySlug : '(personal)'
    console.log(`  ✓ created ${title}  — llc=${tagLabel} — id=${row.id}`)
    created++
  }

  console.log(`\nDone. ${created} created, ${skipped} already present.`)
})()
