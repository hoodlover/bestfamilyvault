// Pre-creates the entries Lance told me about on 2026-06-07 to hold the
// three families of tax/financial documents he drops in Vault File Drop\:
//
//   1120-S  → "IRS — Path to Change LLC 1120-S Filings"
//             under Path to Change LLC > Tax Filings,
//             llcSubcategoryId tagged with Path to Change LLC.
//   1040 + GA state  → "IRS / GA — Lance & Heather Cobb Federal & State Tax Filings"
//             under Finance > Taxes.
//   PFS (Personal Financial Statement)  → "Lance & Heather Cobb —
//             Personal Financial Statement (Net Worth)" under Finance.
//
// All three are type=document so the auto-importer's matcher can find
// them (the matcher only walks the entries table). Titles deliberately
// include "IRS" / "Internal Revenue Service" / institution keywords so
// findMatchingEntry's ilike on c.institution lands.
//
// Caveat: tax forms don't carry a last-4, so the matcher's strongest
// signal is missing. First few drops may still land in REVIEW.txt; if
// that becomes a pattern, the next step is extending the import-inbox
// PROMPT to extract a documentSubtype ('1120-S' | '1040' | 'PFS' |
// other) and adding a tax-doc routing branch.
//
// Idempotent: skips any of the three titles already present.

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { categories, subcategories, entries, users } from '@/lib/db/schema'

interface Container {
  title: string
  noteContent: string
  // Lookup keys
  categorySlug: string
  subcategorySlug: string | null
  // LLC tag (used only for the 1120-S target so the line-item flow
  // inherits Path to Change LLC if we ever wire it).
  llcSubcategorySlug: string | null
}

const CONTAINERS: Container[] = [
  {
    title: 'IRS — Path to Change LLC 1120-S Filings',
    noteContent:
      'Federal Form 1120-S (S-corp tax return) for Path to Change LLC. ' +
      'Drop each year\'s 1120-S into Vault File Drop\\ and the import ' +
      'classifier will route it here (or land in REVIEW.txt for manual ' +
      'attach if the matcher misses).',
    categorySlug: 'path-to-change-llc',
    subcategorySlug: 'tax-filings',
    llcSubcategorySlug: 'path-to-change',  // Receipts > Path to Change, LLC
  },
  {
    title: 'IRS / GA — Lance & Heather Cobb Federal & State Tax Filings (1040)',
    noteContent:
      'Joint Form 1040 (federal) + Georgia state return for Lance & ' +
      'Heather Cobb. One container entry; each year\'s federal and ' +
      'state returns attach here as PDFs.',
    categorySlug: 'finance',
    subcategorySlug: 'taxes',
    llcSubcategorySlug: null,
  },
  {
    title: 'Lance & Heather Cobb — Personal Financial Statement (Net Worth)',
    noteContent:
      'Snapshot net-worth statements (Personal Financial Statement / ' +
      'PFS) for Lance & Heather Cobb. Each new PFS attaches here so ' +
      'the history accumulates in one place.',
    categorySlug: 'finance',
    subcategorySlug: null,
    llcSubcategorySlug: null,
  },
]

;(async () => {
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'lance.climb@gmail.com'))
    .limit(1)
    .then((r) => r[0])
  if (!owner) throw new Error('Owner user not found')

  let created = 0
  let skipped = 0

  for (const c of CONTAINERS) {
    // Resolve target category + subcategory + LLC tag once so a bad
    // slug fails loudly before any insert.
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, c.categorySlug))
      .limit(1)
      .then((r) => r[0])
    if (!cat) throw new Error(`Category not found: ${c.categorySlug}`)

    let subId: string | null = null
    if (c.subcategorySlug) {
      const sub = await db
        .select({ id: subcategories.id })
        .from(subcategories)
        .where(and(eq(subcategories.categoryId, cat.id), eq(subcategories.slug, c.subcategorySlug)))
        .limit(1)
        .then((r) => r[0])
      if (!sub) throw new Error(`Subcategory not found: ${c.categorySlug}/${c.subcategorySlug}`)
      subId = sub.id
    }

    let llcId: string | null = null
    if (c.llcSubcategorySlug) {
      const llc = await db
        .select({ id: subcategories.id })
        .from(subcategories)
        .innerJoin(categories, eq(categories.id, subcategories.categoryId))
        .where(and(eq(categories.slug, 'receipts'), eq(subcategories.slug, c.llcSubcategorySlug)))
        .limit(1)
        .then((r) => r[0])
      if (!llc) throw new Error(`LLC subcategory not found: receipts/${c.llcSubcategorySlug}`)
      llcId = llc.id
    }

    // Idempotency: skip if a same-titled entry from this owner exists.
    const existing = await db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.title, c.title), eq(entries.createdBy, owner.id)))
      .limit(1)
      .then((r) => r[0])
    if (existing) {
      console.log(`  · skip — "${c.title}" already exists (${existing.id})`)
      skipped++
      continue
    }

    const [row] = await db
      .insert(entries)
      .values({
        categoryId: cat.id,
        subcategoryId: subId,
        llcSubcategoryId: llcId,
        type: 'document',
        title: c.title,
        noteContent: c.noteContent,
        isFavorite: false,
        isRecurring: false,
        isPrivate: false,
        isPersonal: false,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      .returning({ id: entries.id })

    console.log(`  ✓ created "${c.title}"`)
    console.log(`    → /entries/${row.id}/edit`)
    created++
  }

  console.log(`\nDone. ${created} created, ${skipped} already present.`)
})()
