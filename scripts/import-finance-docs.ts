// One-shot bulk import of finance + camping + advisor + pets documents
// from c:\Users\lance\Documents into the vault.
//
// Idempotent at the entry/note level: each target searches for an existing
// row by title first; appends files if found, creates new if not.
// Files themselves always upload fresh (no dedupe on blob name) so re-running
// will create duplicate file rows. Run once.
//
//   npx tsx --env-file=.env.local scripts/import-finance-docs.ts
//
// Requires DATABASE_URL, BLOB_READ_WRITE_TOKEN, ENCRYPTION_KEY in env.

// Run with: npx tsx --env-file=.env.local scripts/import-finance-docs.ts
import fs from 'node:fs'
import path from 'node:path'
import { put } from '@vercel/blob'
import { eq, and } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  entries,
  notes,
  files as filesTable,
  categories,
  subcategories,
  users,
} from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'
import { OWNER } from '@/lib/family-config'

const ROOT_FF = String.raw`C:\Users\lance\Documents\Family Finances`
const ROOT_FP = String.raw`C:\Users\lance\Documents\4625 Forest Place`

interface FileToImport {
  src: string
}

type TargetCommon = {
  categorySlug: string
  subcategoryName?: string
  files: FileToImport[]
  body?: string
}

type NoteTarget = TargetCommon & {
  kind: 'note'
  title: string
}

type EntryTarget = TargetCommon & {
  kind: 'entry'
  title: string
  type: 'login' | 'note' | 'document' | 'bank_account' | 'credit_card' | 'identity'
}

type Target = NoteTarget | EntryTarget

// ─── Targets ────────────────────────────────────────────────────────────────

const TARGETS: Target[] = [
  // === Family Finances 2024+ ===
  {
    kind: 'entry',
    type: 'credit_card',
    title: 'AMEX Blue Cash 01001',
    categorySlug: 'finance',
    files: [
      { src: `${ROOT_FF}\\Credit Card Accounts\\AMEX Blue Cash Credit Card - 01001\\2025-09-08.pdf` },
    ],
  },
  {
    kind: 'note',
    title: 'Cobb Family 2024 Taxes',
    categorySlug: 'finance',
    subcategoryName: 'Taxes',
    body: 'Federal + GA state returns for the Cobb Family for tax year 2024.',
    files: [
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\2024_FEDERAL_RETURN_2026-04-26_095949.pdf` },
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\2024_GA_RETURN_2026-04-26_100022.pdf` },
    ],
  },
  {
    kind: 'note',
    title: 'Paiton 2024 Taxes',
    categorySlug: 'finance',
    subcategoryName: 'Taxes',
    body: "Paiton's federal + GA state returns for tax year 2024.",
    files: [
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\2024 Paiton_FEDERAL_RETURN_2026-04-27_082229.pdf` },
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\2024_Paiton_GA_RETURN_2026-04-27_082232.pdf` },
    ],
  },
  {
    kind: 'note',
    title: '3220 Continental 2024 Property Tax',
    categorySlug: 'home',
    subcategoryName: 'Continental Drive 3220',
    body: '2024 property tax records for 3220 Continental Drive — Forsyth County GA.',
    files: [
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\3220 Conti Map 220 331-R Tax_bill-payment-11-23-2024.pdf` },
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\3220 Conti Property Report Forsyth County, GA - Report_ 220 331.pdf` },
    ],
  },
  {
    kind: 'note',
    title: '4625 Forest 2024 Property Tax',
    categorySlug: 'home',
    subcategoryName: 'Forest Place 4625',
    body: '2024 property tax records for 4625 Forest Place — Forsyth County GA. Includes the 2011 outside photo for reference.',
    files: [
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\4625 Forest Map 199 112 Tax-bill-2024-217771.pdf` },
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\4625 Forest Property Report Forsyth County, GA - Report_ 199 112.pdf` },
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2024\\Forest Place 2011 Outside Photo.jpg` },
    ],
  },
  {
    kind: 'note',
    title: 'Cobb Family 2025 Taxes',
    categorySlug: 'finance',
    subcategoryName: 'Taxes',
    body: 'Tax year 2025 — placeholder note. Currently has the State 1120s TurboTax filing receipt; more docs to follow.',
    files: [
      { src: `${ROOT_FF}\\Taxes\\Cobb Family\\2025\\State 1120s Turbotax $55.pdf` },
    ],
  },
  {
    kind: 'note',
    title: 'PTC 2024 Taxes',
    categorySlug: 'path-to-change-llc',
    subcategoryName: 'Taxes',
    body: 'Path to Change LLC — Form 1120S S-Corp tax return + records for tax year 2024.',
    files: [
      { src: `${ROOT_FF}\\Taxes\\Path to Change LLC\\2024\\2024 Path to Change LLC Form 1120S  S Corps Tax Return_Records.pdf` },
    ],
  },

  // === Camping Organization (no date filter) ===
  {
    kind: 'entry',
    type: 'document',
    title: 'Ammo Box Labels (Garage)',
    categorySlug: 'home',
    subcategoryName: 'Camping',
    files: [
      { src: `${ROOT_FP}\\Camping Organization\\Ammo Box Labels Garage.docx` },
    ],
  },
  {
    kind: 'entry',
    type: 'document',
    title: 'Camp Equipment List - Tubs',
    categorySlug: 'home',
    subcategoryName: 'Camping',
    files: [
      { src: `${ROOT_FP}\\Camping Organization\\Camp Equipment List 2021 Tubs.docx` },
    ],
  },
  {
    // UPDATE existing entry — title matches "Camp Equipment List Binto Bags"
    kind: 'entry',
    type: 'document',
    title: 'Camp Equipment List Binto Bags',
    categorySlug: 'home',
    subcategoryName: 'Camping',
    files: [
      { src: `${ROOT_FP}\\Camping Organization\\Camp Equipment List Binto Bags.docx` },
    ],
  },

  // === Financial Advisor — Michael Palmer (21 files, all 12.21 dated) ===
  {
    kind: 'note',
    title: 'Michael Palmer 2021 Year-End Packet',
    categorySlug: 'finance',
    subcategoryName: 'Investments',
    body: `Year-end 2021 financial snapshot prepared for Michael Palmer (financial advisor).
Includes: insurance summaries (life, auto, homeowners), retirement accounts (401k, IRA, SEP, PCA),
brokerage accounts (Robinhood, Stash, Stockpile, TDA), and account statements.

This is a frozen snapshot — current account balances live on each individual entry in the vault.`,
    files: [
      'AAA Life Ins Policy Summary - Lance $100K.pdf',
      'CFS LLC Checking 12.21 - Lances LLC.pdf',
      'Heather 401(K)-TDA Mix Up-Wont Change-Path to Change 12.21.pdf',
      'Heather SEP IRA-Path To Change 12.21.pdf',
      'Lance IRA-12.21.pdf',
      'Lance Life Ins Application.pdf',
      'Lances NDS 401(k) Plan 2021 Q4.pdf',
      'PCA Retirement Plan 12.21-Lance.pdf',
      'Robinhood 12.21.pdf',
      'Savings eStmt_2021-12-28.pdf',
      'Stash 12.21.pdf',
      'Stockpile 12.21.pdf',
      'TDA-Home Trading Account 12.21 - $0.pdf',
      'USAA 12.21 Homeowners Ins Packet.pdf',
      'USAA Auto Ins Cards Vins.pdf',
      'USAA Auto Insurance Coverages 2022.pdf',
      'USAA Auto Insurance Discounts 2022.pdf',
      'USAA Auto Insurance Policy (GA) - 5 Drivers.pdf',
      'USAA Home Auto Ins Statement 1.22.pdf',
      'USAA Life Ins Policy Summary - Heather $100K.pdf',
      'USAA Update Your Valuable Personal Property Insurance.pdf',
    ].map((f) => ({ src: `${ROOT_FP}\\Financial Advisor Docs - Michael Palmer\\${f}` })),
  },

  // === Pets ===
  {
    kind: 'note',
    title: 'Havoc, Treecko & Tito Vet Records',
    categorySlug: 'kids',
    subcategoryName: 'Pets',
    body: 'Vet visits + iguana / reptile care info for Havoc, Treecko & Tito (Sawnee Animal Clinic).',
    files: [
      '1.15.21 Sawnee An Clinic Pitri $54.40.jpeg',
      '1.15.21 Sawnee An Clinic Pitri Exam Note 1.jpeg',
      '1.15.21 Sawnee An Clinic Pitri Exam Note 2.jpeg',
      '12.16.20 Sawnee An Clinic Pitri $85.16 2.jpeg',
      '12.16.20 Sawnee An Clinic Pitri $85.16.jpeg',
      '12.16.20 Sawnee An Clinic Pitri Exam Notes Critical Care Carnivore.jpeg',
      'Iguana Info Pamphlet 1.jpeg',
      'Reptile Care.jpeg',
    ].map((f) => ({ src: `${ROOT_FP}\\Pets\\Havoc, Treecko & Tito\\${f}` })),
  },
  {
    kind: 'note',
    title: 'Martian, Nala & George Vet Records',
    categorySlug: 'kids',
    subcategoryName: 'Pets',
    body: 'Vet records + spay receipts for Martian, Nala & George (Banfield + others).',
    files: [
      '7.12.17 Spay Martian Nala.jpeg',
      'George & Martian Checkup 9.19.2020 Bannfield.pdf',
      'Nala.jpeg',
    ].map((f) => ({ src: `${ROOT_FP}\\Pets\\Martian, Nala & George\\${f}` })),
  },
  {
    kind: 'note',
    title: 'River Records',
    categorySlug: 'kids',
    subcategoryName: 'Pets',
    body: "All of River's records — birth certificate, microchip registration, pedigree, vet visits, receipts.",
    files: [
      'Crestview 7.21.21 River 33lbs.jpeg',
      'River 3.28.2021 Receipts & Purchase Documents.pdf',
      'River Receipts 2021.jpeg',
      'River Tracking ID & Folder Cover.jpeg',
      'Rivers Birth Certificate 3.28.2021.jpg',
      'Rivers First Doctor Visit.pdf',
      'Rivers Microchip Registration.jpg',
      'Rivers Microchip Registration.pdf',
      'Rivers Pedigree Family Tree.jpg',
    ].map((f) => ({ src: `${ROOT_FP}\\Pets\\River\\${f}` })),
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  switch (ext) {
    case '.pdf': return 'application/pdf'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.gif': return 'image/gif'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.doc': return 'application/msword'
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.csv': return 'text/csv'
    case '.txt': return 'text/plain'
    default: return 'application/octet-stream'
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const owner = await db.select().from(users).where(eq(users.email, OWNER.emails[0])).then((r) => r[0])
  if (!owner) throw new Error(`Owner user not found by email ${OWNER.emails[0]}`)
  console.log(`Importing as: ${owner.email} (${owner.id})\n`)

  const allCategories = await db.select().from(categories)
  const allSubs = await db.select().from(subcategories)

  function categoryId(slug: string): string {
    const c = allCategories.find((x) => x.slug === slug)
    if (!c) throw new Error(`Category not found by slug: ${slug}`)
    return c.id
  }

  function subcategoryId(catId: string, name: string): string {
    const norm = name.toLowerCase()
    const s = allSubs.find((x) => x.categoryId === catId && x.name.toLowerCase() === norm)
    if (!s) throw new Error(`Subcategory not found: name="${name}" under category ${catId}`)
    return s.id
  }

  let totalFiles = 0
  let okFiles = 0
  let failedFiles: string[] = []

  for (const target of TARGETS) {
    console.log(`\n→ ${target.kind === 'note' ? '📝' : '📂'} ${target.title}`)
    const catId = categoryId(target.categorySlug)
    const subId = target.subcategoryName ? subcategoryId(catId, target.subcategoryName) : null

    let entryId: string | null = null
    let noteId: string | null = null

    if (target.kind === 'note') {
      const existing = await db.select().from(notes).where(eq(notes.title, target.title)).then((r) => r[0])
      if (existing) {
        noteId = existing.id
        console.log(`   ↺ updating existing note (${existing.id.slice(0, 8)})`)
      } else {
        const [created] = await db
          .insert(notes)
          .values({
            title: target.title,
            content: encrypt(target.body ?? '') ?? '',
            categoryId: catId,
            subcategoryId: subId,
            tags: [],
            isPrivate: false,
            isPersonal: false,
            createdBy: owner.id,
            updatedBy: owner.id,
          })
          .returning()
        noteId = created.id
        console.log(`   + created note (${created.id.slice(0, 8)})`)
      }
    } else {
      // Entry
      const existing = await db
        .select()
        .from(entries)
        .where(and(eq(entries.title, target.title), eq(entries.type, target.type)))
        .then((r) => r[0])
      if (existing) {
        entryId = existing.id
        console.log(`   ↺ updating existing entry (${existing.id.slice(0, 8)})`)
      } else {
        const [created] = await db
          .insert(entries)
          .values({
            categoryId: catId,
            subcategoryId: subId,
            type: target.type,
            title: target.title,
            isFavorite: false,
            isPrivate: false,
            isPersonal: false,
            isRecurring: false,
            createdBy: owner.id,
            updatedBy: owner.id,
          })
          .returning()
        entryId = created.id
        console.log(`   + created entry (${created.id.slice(0, 8)})`)
      }
    }

    for (const f of target.files) {
      totalFiles++
      const filename = path.basename(f.src)
      try {
        if (!fs.existsSync(f.src)) {
          console.log(`   ✗ ${filename}  — file not found on disk`)
          failedFiles.push(filename)
          continue
        }
        const buffer = fs.readFileSync(f.src)
        const contentType = guessContentType(filename)
        const ts = Date.now()
        const blobPath = `vault/${owner.id}/${ts}-${Math.floor(Math.random() * 1e6)}-${sanitizeFilename(filename)}`
        // Match the existing uploadFile() action's convention: private
        // blobs. Files are served back to the browser via auth-gated proxy
        // routes (the same pattern as letter blobs).
        const blob = await put(blobPath, buffer, { access: 'private', contentType })
        await db.insert(filesTable).values({
          entryId,
          noteId,
          filename,
          blobUrl: blob.url,
          contentType,
          size: buffer.length,
          isPrivate: false,
          uploadedBy: owner.id,
        })
        console.log(`   ✓ ${filename}  (${(buffer.length / 1024).toFixed(0)} KB)`)
        okFiles++
      } catch (err) {
        console.log(`   ✗ ${filename}  — ${err instanceof Error ? err.message : String(err)}`)
        failedFiles.push(filename)
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────`)
  console.log(`Done: ${okFiles}/${totalFiles} files uploaded`)
  if (failedFiles.length > 0) {
    console.log(`Failed (${failedFiles.length}):`)
    for (const f of failedFiles) console.log(`  - ${f}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
