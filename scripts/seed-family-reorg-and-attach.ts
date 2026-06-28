// Two operations Lance lined up on 2026-06-07 night:
//
// A) Reorganize personal/joint financial entries under Family ("Home"):
//    - Create Family > Taxes and Family > Checking subcategories
//    - Move the 1040 container from Finance > Taxes → Family > Taxes
//    - Move the PFS container from Finance → Family > Taxes
//    - Move BofA Checking 0202 from Finance > Checking & Savings →
//      Family > Checking
//    - Create a Path to Change LLC Financial Statements container
//      under Path to Change LLC > Tax Filings (for P&L + Balance
//      Sheets that fell out of the auto-importer)
//
// B) Attach the 13 PDFs sitting in REVIEW (tax docs, PFS, PtC
//    financial statements) to the right container entries:
//    - 2023/2024 Federal 1040 + state filings → 1040 container
//    - 2025_FEDERAL_RETURN + 2025_GA_RETURN → 1040 container
//    - 2024 Path to Change LLC 1120-S → existing 1120-S container
//    - Final 2024/2025 Balance Sheet + Profit and Loss (4) → new PtC
//      Financial Statements container
//    - Heather PFS (BOA) + Lance & Heather PFS (SouthState) → PFS
//      container
//
// All uploads go through @vercel/blob with content_hash stamped so
// the dup detector catches any re-drops. Source PDFs move to
// Vault File Drop\Imported\<year>\ on success.
//
// Idempotent on the reorg side (find-or-create, skip-if-moved). The
// attach side checks for existing file rows by name on the target
// entry before re-uploading.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { put as blobPut } from '@vercel/blob'
import { db } from '@/lib/db'
import {
  categories,
  subcategories,
  entries,
  files as filesTable,
  users,
} from '@/lib/db/schema'

void blobPut  // silence unused-import lint — `put` is already aliased above

const INBOX = String.raw`C:\Users\lance\Documents\Vault File Drop`

if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing DATABASE_URL or BLOB_READ_WRITE_TOKEN — pass --env-file=.env.local')
  process.exit(1)
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function importedDirFor(date: Date): string {
  return path.join(INBOX, 'Imported', String(date.getFullYear()))
}

async function uploadAndAttach(opts: {
  filepath: string
  entryId: string
  ownerId: string
}): Promise<void> {
  if (!fs.existsSync(opts.filepath)) {
    console.log(`     · skip — file not in inbox: ${path.basename(opts.filepath)}`)
    return
  }
  const buffer = fs.readFileSync(opts.filepath)
  const filename = path.basename(opts.filepath)
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')

  // Dup pre-check: if this exact hash already attached to this entry,
  // skip. Lets a partial re-run pick up where it left off.
  const existing = await db
    .select({ id: filesTable.id })
    .from(filesTable)
    .where(and(eq(filesTable.entryId, opts.entryId), eq(filesTable.contentHash, hash)))
    .limit(1)
  if (existing.length > 0) {
    console.log(`     · already attached: ${filename}`)
    return
  }

  const ext = path.extname(filename).toLowerCase()
  const contentType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream'
  const blobPath = `vault/${opts.ownerId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}-${sanitize(filename)}`
  const blob = await put(blobPath, buffer, { access: 'private', contentType })

  await db.insert(filesTable).values({
    entryId: opts.entryId,
    filename,
    blobUrl: blob.url,
    contentType,
    size: buffer.length,
    contentHash: hash,
    isPrivate: false,
    uploadedBy: opts.ownerId,
  })

  console.log(`     ✓ attached: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`)

  // Move to Imported/<year>/.
  const importedDir = importedDirFor(new Date())
  fs.mkdirSync(importedDir, { recursive: true })
  let dest = path.join(importedDir, filename)
  let n = 1
  while (fs.existsSync(dest)) {
    const parsed = path.parse(path.join(importedDir, filename))
    dest = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(opts.filepath, dest)
  console.log(`     ✓ moved → Imported/${new Date().getFullYear()}/${path.basename(dest)}`)
}

async function findOrCreateSubcategory(opts: {
  categoryId: string
  name: string
  slug: string
  sortOrder: number
}): Promise<string> {
  const existing = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, opts.categoryId), eq(subcategories.slug, opts.slug)))
    .limit(1)
    .then((r) => r[0])
  if (existing) {
    console.log(`     · subcategory exists: ${opts.name}`)
    return existing.id
  }
  const [row] = await db
    .insert(subcategories)
    .values({
      categoryId: opts.categoryId,
      name: opts.name,
      slug: opts.slug,
      sortOrder: opts.sortOrder,
    })
    .returning({ id: subcategories.id })
  console.log(`     ✓ subcategory created: ${opts.name}`)
  return row.id
}

;(async () => {
  const owner = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'lance.climb@gmail.com'))
    .limit(1)
    .then((r) => r[0])
  if (!owner) throw new Error('Owner user not found')

  // ── A) Categories + subs ──────────────────────────────────────
  console.log('\n── Phase A — reorg ──')

  const family = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'kids'))  // Family category's slug is 'kids' (per category dump)
    .limit(1)
    .then((r) => r[0])
  if (!family) throw new Error('Family category (slug=kids) not found')

  const ptcLlc = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'path-to-change-llc'))
    .limit(1)
    .then((r) => r[0])
  if (!ptcLlc) throw new Error('Path to Change LLC category not found')

  const familyTaxesId = await findOrCreateSubcategory({
    categoryId: family.id,
    name: 'Taxes',
    slug: 'family-taxes',
    sortOrder: 50,
  })
  const familyCheckingId = await findOrCreateSubcategory({
    categoryId: family.id,
    name: 'Checking',
    slug: 'family-checking',
    sortOrder: 60,
  })

  // Path to Change LLC > Tax Filings (existing) — re-look up id.
  const ptcTaxFilings = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, ptcLlc.id), eq(subcategories.slug, 'tax-filings')))
    .limit(1)
    .then((r) => r[0])
  if (!ptcTaxFilings) throw new Error('Path to Change LLC > Tax Filings not found')

  // ── Re-parent the existing container entries ───────────────────
  // 1. 1040 container → Family > Taxes
  const r1 = await db
    .update(entries)
    .set({ categoryId: family.id, subcategoryId: familyTaxesId, updatedAt: new Date() })
    .where(
      and(
        eq(entries.title, 'IRS / GA — Lance & Heather Cobb Federal & State Tax Filings (1040)'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .returning({ id: entries.id })
  console.log(r1.length > 0 ? `     ✓ moved 1040 container → Family > Taxes` : `     · 1040 container not found`)

  // 2. PFS container → Family > Taxes
  const r2 = await db
    .update(entries)
    .set({ categoryId: family.id, subcategoryId: familyTaxesId, updatedAt: new Date() })
    .where(
      and(
        eq(entries.title, 'Lance & Heather Cobb — Personal Financial Statement (Net Worth)'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .returning({ id: entries.id })
  console.log(r2.length > 0 ? `     ✓ moved PFS container → Family > Taxes` : `     · PFS container not found`)

  // 3. BofA Checking 0202 → Family > Checking
  const r3 = await db
    .update(entries)
    .set({ categoryId: family.id, subcategoryId: familyCheckingId, updatedAt: new Date() })
    .where(
      and(
        eq(entries.title, 'BofA Checking 0202'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .returning({ id: entries.id })
  console.log(r3.length > 0 ? `     ✓ moved BofA Checking 0202 → Family > Checking` : `     · BofA 0202 not found`)

  // 4. Create Path to Change LLC Financial Statements container (find or create).
  let ptcFinancialStmtsId: string
  {
    const existing = await db
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.title, 'Path to Change LLC — Financial Statements (P&L + Balance Sheet)'),
          eq(entries.createdBy, owner.id),
        ),
      )
      .limit(1)
      .then((r) => r[0])
    if (existing) {
      ptcFinancialStmtsId = existing.id
      console.log(`     · PtC Financial Statements container already exists`)
    } else {
      const [row] = await db
        .insert(entries)
        .values({
          categoryId: ptcLlc.id,
          subcategoryId: ptcTaxFilings.id,
          type: 'document',
          title: 'Path to Change LLC — Financial Statements (P&L + Balance Sheet)',
          noteContent:
            'Year-end profit & loss + balance sheet PDFs for Path to Change LLC. ' +
            'Year is in each attached filename.',
          isPrivate: false,
          isPersonal: false,
          isFavorite: false,
          isRecurring: false,
          createdBy: owner.id,
          updatedBy: owner.id,
        })
        .returning({ id: entries.id })
      ptcFinancialStmtsId = row.id
      console.log(`     ✓ created PtC Financial Statements container`)
    }
  }

  // Lookup ids for the other already-existing target containers.
  const taxFilings1040 = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.title, 'IRS / GA — Lance & Heather Cobb Federal & State Tax Filings (1040)'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .limit(1)
    .then((r) => r[0])
  if (!taxFilings1040) throw new Error('1040 container missing — seed-tax-doc-containers.ts not run?')

  const ptc1120s = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.title, 'IRS — Path to Change LLC 1120-S Filings'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .limit(1)
    .then((r) => r[0])
  if (!ptc1120s) throw new Error('1120-S container missing')

  const pfsContainer = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.title, 'Lance & Heather Cobb — Personal Financial Statement (Net Worth)'),
        eq(entries.createdBy, owner.id),
      ),
    )
    .limit(1)
    .then((r) => r[0])
  if (!pfsContainer) throw new Error('PFS container missing')

  // ── B) Attach the 13 REVIEW files ─────────────────────────────
  console.log('\n── Phase B — attaching REVIEW backlog ──')

  const attachments: Array<{ filename: string; entryId: string }> = [
    // 1040 container — federal + state for 2023, 2024, 2025
    { filename: '2023 Federal 1040 Lance & Heather.pdf',                       entryId: taxFilings1040.id },
    { filename: '2023 State Filing Lance & Heather.pdf',                       entryId: taxFilings1040.id },
    { filename: '2024 Federal 1040 Lance & Heather.pdf',                       entryId: taxFilings1040.id },
    { filename: '2024 State Filing Lance & Heather.pdf',                       entryId: taxFilings1040.id },
    { filename: '2025_FEDERAL_RETURN_2026-04-27_070721.pdf',                   entryId: taxFilings1040.id },
    { filename: '2025_GA_RETURN_2026-04-27_070736.pdf',                        entryId: taxFilings1040.id },
    // 1120-S container — PtC LLC corporate tax return
    { filename: '2024 Path to Change LLC Form 1120S  S Corps Tax Return_Filing Final.pdf', entryId: ptc1120s.id },
    // PtC LLC Financial Statements (new container)
    { filename: 'Final 2024 Balance Sheet.pdf',                                entryId: ptcFinancialStmtsId },
    { filename: 'Final 2024 Profit and Loss.pdf',                              entryId: ptcFinancialStmtsId },
    { filename: 'Final 2025 Balance Sheet.pdf',                                entryId: ptcFinancialStmtsId },
    { filename: 'Final 2025 Profit and Loss.pdf',                              entryId: ptcFinancialStmtsId },
    // PFS container
    { filename: 'Heather_Cobb_Personal_Financial_Statement-BOA.pdf',           entryId: pfsContainer.id },
    { filename: 'PFS form 6-25 Lance & Heather Cobb.pdf',                      entryId: pfsContainer.id },
  ]

  for (const a of attachments) {
    console.log(`\n  ${a.filename}`)
    await uploadAndAttach({
      filepath: path.join(INBOX, a.filename),
      entryId: a.entryId,
      ownerId: owner.id,
    })
  }

  console.log('\nDone.')
})()
