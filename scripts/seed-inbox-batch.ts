// One-shot inbox triage for 2026-06-07: file the four PDFs Lance dropped
// into Vault File Drop\ but which the auto-importer couldn't match to
// any existing entry.
//
// Plan (per Lance):
//   1. $500 May FCA Gift Receipt.pdf → create "FCA Monthly Donation"
//      recurring entry under Finance ($500/monthly). Attach PDF.
//   2. EIN H&L Havens CP_575_G.pdf → create
//      "H&L Havens LLC IRS EIN (CP-575)" under H&L Havens LLC > IRS.
//      Attach PDF.
//   3. Place of Grace LLC Name Res.pdf → create new top-level category
//      "Place of Grace LLC" with subcategories (Startup Docs, Tax
//      Filings, IRS, Documents). Then create entry "Place of Grace LLC
//      Name Reservation" under Place of Grace LLC > Startup Docs. Attach
//      PDF.
//   4. Vault Color Scheme.png → create a "Best Family Vault Setup Notes" row in
//      the notes table under How Tos, with the PNG attached. Lets Lance
//      reference the color palette inside the vault itself when tweaking
//      future UI.
//
// Each PDF gets uploaded to Vercel Blob, attached as a file row with
// content_hash stamped so future re-drops are caught by the duplicate
// detector. Source files are moved to Vault File Drop\Imported\2026\.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { put } from '@vercel/blob'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  categories,
  subcategories,
  entries,
  notes,
  files as filesTable,
  users,
} from '@/lib/db/schema'

const INBOX = String.raw`C:\Users\lance\Documents\Vault File Drop`
const IMPORTED = path.join(INBOX, 'Imported', String(new Date().getFullYear()))

const FCA_FILE = '$500 May FCA Gift Receipt.pdf'
const EIN_FILE = 'EIN H&L Havens CP_575_G.pdf'
const POG_FILE = 'Place of Grace LLC Name Res.pdf'
const COLOR_FILE = 'Vault Color Scheme.png'

const FCA_PATH = path.join(INBOX, FCA_FILE)
const EIN_PATH = path.join(INBOX, EIN_FILE)
const POG_PATH = path.join(INBOX, POG_FILE)
const COLOR_PATH = path.join(INBOX, COLOR_FILE)

if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Missing DATABASE_URL or BLOB_READ_WRITE_TOKEN — pass --env-file=.env.local')
  process.exit(1)
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

interface UploadResult {
  fileRowId: string
  hash: string
}

async function uploadAndAttach(opts: {
  filepath: string
  ownerId: string
  contentType: string
  // Polymorphic FK — set one of entryId or noteId. The `file` row's
  // existing columns accept either; tax/inbox PDFs go to entryId,
  // setup-note attachments go to noteId.
  entryId?: string
  noteId?: string
}): Promise<UploadResult> {
  const buffer = fs.readFileSync(opts.filepath)
  const filename = path.basename(opts.filepath)
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')

  const blobPath = `vault/${opts.ownerId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}-${sanitize(filename)}`
  const blob = await put(blobPath, buffer, { access: 'private', contentType: opts.contentType })

  const [row] = await db
    .insert(filesTable)
    .values({
      entryId: opts.entryId ?? null,
      noteId: opts.noteId ?? null,
      filename,
      blobUrl: blob.url,
      contentType: opts.contentType,
      size: buffer.length,
      contentHash: hash,
      isPrivate: false,
      uploadedBy: opts.ownerId,
    })
    .returning()

  console.log(`     ✓ ${filename} uploaded (${(buffer.length / 1024).toFixed(0)} KB)`)
  return { fileRowId: row.id, hash }
}

function moveToImported(filepath: string) {
  fs.mkdirSync(IMPORTED, { recursive: true })
  const dest = path.join(IMPORTED, path.basename(filepath))
  let final = dest
  let n = 1
  while (fs.existsSync(final)) {
    const parsed = path.parse(dest)
    final = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`)
    n++
  }
  fs.renameSync(filepath, final)
  console.log(`     ✓ moved → Imported/${new Date().getFullYear()}/${path.basename(final)}`)
}

;(async () => {
  // ─── Resolve known categories + the owner ───────────────────
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

  const hlHavens = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'h-l-havens-llc'))
    .limit(1)
    .then((r) => r[0])
  if (!hlHavens) throw new Error('H&L Havens LLC category not found')

  const hlIrs = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, hlHavens.id), eq(subcategories.slug, 'irs')))
    .limit(1)
    .then((r) => r[0])
  if (!hlIrs) throw new Error('H&L Havens > IRS subcategory not found')

  // ─── 1. FCA Monthly Donation ────────────────────────────────
  if (!fs.existsSync(FCA_PATH)) {
    console.log(`(skip FCA — ${FCA_FILE} no longer in inbox)`)
  } else {
    console.log(`\n  FCA Monthly Donation`)
    const renewalDate = new Date()
    renewalDate.setMonth(renewalDate.getMonth() + 1)
    const renewalYmd = renewalDate.toISOString().slice(0, 10)

    const [fcaEntry] = await db
      .insert(entries)
      .values({
        categoryId: finance.id,
        type: 'note',
        title: 'FCA Monthly Donation',
        noteContent:
          'Monthly $500 donation to Fellowship of Christian Athletes, ' +
          'paid from BofA Checking 0202. Receipt for each month is attached.',
        isRecurring: true,
        subscriptionAmountCents: 50000,
        subscriptionPeriod: 'monthly',
        subscriptionStartedAt: '2026-06-03',
        subscriptionRenewsAt: renewalYmd,
        isFavorite: false,
        isPrivate: false,
        isPersonal: false,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      .returning()
    console.log(`     ✓ entry created — id=${fcaEntry.id}`)
    await uploadAndAttach({ filepath: FCA_PATH, entryId: fcaEntry.id, ownerId: owner.id, contentType: 'application/pdf' })
    moveToImported(FCA_PATH)
  }

  // ─── 2. H&L Havens IRS EIN (CP-575) ─────────────────────────
  if (!fs.existsSync(EIN_PATH)) {
    console.log(`(skip EIN — ${EIN_FILE} no longer in inbox)`)
  } else {
    console.log(`\n  H&L Havens LLC IRS EIN (CP-575)`)
    const [einEntry] = await db
      .insert(entries)
      .values({
        categoryId: hlHavens.id,
        subcategoryId: hlIrs.id,
        type: 'document',
        title: 'H&L Havens LLC IRS EIN (CP-575)',
        noteContent: 'IRS CP-575 letter confirming H&L Havens LLC EIN assignment.',
        isPrivate: false,
        isPersonal: false,
        isFavorite: false,
        isRecurring: false,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      .returning()
    console.log(`     ✓ entry created — id=${einEntry.id}`)
    await uploadAndAttach({ filepath: EIN_PATH, entryId: einEntry.id, ownerId: owner.id, contentType: 'application/pdf' })
    moveToImported(EIN_PATH)
  }

  // ─── 3. Place of Grace LLC — create category + subcategories + entry ──
  if (!fs.existsSync(POG_PATH)) {
    console.log(`(skip Place of Grace — ${POG_FILE} no longer in inbox)`)
  } else {
    console.log(`\n  Place of Grace LLC`)
    // Top-level category (idempotent — find or create).
    let pog = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, 'place-of-grace-llc'))
      .limit(1)
      .then((r) => r[0])
    if (!pog) {
      const [created] = await db
        .insert(categories)
        .values({
          name: 'Place of Grace LLC',
          slug: 'place-of-grace-llc',
          sortOrder: 75,
        })
        .returning({ id: categories.id })
      pog = created
      console.log(`     ✓ category created — id=${pog.id}`)
    } else {
      console.log(`     · category already exists — id=${pog.id}`)
    }

    // Subcategories — Startup Docs / Tax Filings / IRS / Documents.
    // Same shape as the H&L Havens minimal set, idempotent insert.
    const subs = [
      { name: 'Startup Docs', slug: 'startup-docs', sortOrder: 10 },
      { name: 'Tax Filings', slug: 'tax-filings', sortOrder: 20 },
      { name: 'IRS', slug: 'irs', sortOrder: 30 },
      { name: 'Documents', slug: 'documents', sortOrder: 40 },
    ]
    for (const s of subs) {
      const existing = await db
        .select({ id: subcategories.id })
        .from(subcategories)
        .where(and(eq(subcategories.categoryId, pog.id), eq(subcategories.slug, s.slug)))
        .limit(1)
        .then((r) => r[0])
      if (!existing) {
        await db.insert(subcategories).values({
          categoryId: pog.id,
          name: s.name,
          slug: s.slug,
          sortOrder: s.sortOrder,
        })
        console.log(`     ✓ subcategory: ${s.name}`)
      } else {
        console.log(`     · subcategory exists: ${s.name}`)
      }
    }

    // Find startup-docs to file the name-res under.
    const startupDocs = await db
      .select({ id: subcategories.id })
      .from(subcategories)
      .where(and(eq(subcategories.categoryId, pog.id), eq(subcategories.slug, 'startup-docs')))
      .limit(1)
      .then((r) => r[0])
    if (!startupDocs) throw new Error('Startup Docs subcategory missing after create')

    const [pogEntry] = await db
      .insert(entries)
      .values({
        categoryId: pog.id,
        subcategoryId: startupDocs.id,
        type: 'document',
        title: 'Place of Grace LLC Name Reservation',
        noteContent: 'State-issued name-reservation document for Place of Grace LLC.',
        isPrivate: false,
        isPersonal: false,
        isFavorite: false,
        isRecurring: false,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      .returning()
    console.log(`     ✓ entry created — id=${pogEntry.id}`)
    await uploadAndAttach({ filepath: POG_PATH, entryId: pogEntry.id, ownerId: owner.id, contentType: 'application/pdf' })
    moveToImported(POG_PATH)
  }

  // ─── 4. Vault Color Scheme PNG → Best Family Vault Setup Notes ─────
  if (!fs.existsSync(COLOR_PATH)) {
    console.log(`\n(skip Color Scheme — ${COLOR_FILE} no longer in inbox)`)
  } else {
    console.log(`\n  Best Family Vault Setup Notes`)
    const howTos = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, 'business'))
      .limit(1)
      .then((r) => r[0])
    if (!howTos) throw new Error('"How Tos" category (slug=business) not found')

    // Find or create — idempotent so a re-run after dropping a new
    // setup-related PNG/PDF just attaches it to the existing note
    // rather than creating dup notes with the same title.
    let setupNote = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.createdBy, owner.id),
          eq(notes.title, 'Best Family Vault Setup Notes'),
        ),
      )
      .limit(1)
      .then((r) => r[0])

    if (!setupNote) {
      const [created] = await db
        .insert(notes)
        .values({
          categoryId: howTos.id,
          title: 'Best Family Vault Setup Notes',
          content:
            'Reference notes for Best Family Vault setup, theming, and customization.\n\n' +
            '**Color Scheme:** See attached `Vault Color Scheme.png` for the palette ' +
            'used across the app (action-tile accents, banner gradients, dark-mode ' +
            'stone backdrops, the per-user accent ramp for Forest/Crimson/Midnight/' +
            'Harvest themes).',
          isPrivate: false,
          isPersonal: false,
          createdBy: owner.id,
          updatedBy: owner.id,
        })
        .returning({ id: notes.id })
      setupNote = created
      console.log(`     ✓ note created — id=${setupNote.id}`)
    } else {
      console.log(`     · note already exists — id=${setupNote.id}`)
    }

    await uploadAndAttach({
      filepath: COLOR_PATH,
      noteId: setupNote.id,
      ownerId: owner.id,
      contentType: 'image/png',
    })
    moveToImported(COLOR_PATH)
  }

  console.log(`\nDone.`)
})()
