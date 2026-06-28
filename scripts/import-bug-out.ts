// Bulk-import Lance's "Bug Out Folder" into Best Family Vault.
//
// Walks C:\Users\lance\Documents\4625 Forest Place\Bug Out Folder, creates
// subcategories under the existing "End of the World" category to mirror the
// folder structure, redirects sensitive items (bank/insurance/ID/credit-card
// scans) to the existing finance/kids subcategories where they belong, and
// uploads each file as a Vercel Blob with a matching note row.
//
// Default = dry-run (prints what it would do, makes no changes).
// Pass --execute to actually create subcategories, upload blobs, and insert.
//
//   npx tsx --env-file=.env.local scripts/import-bug-out.ts            # dry-run
//   npx tsx --env-file=.env.local scripts/import-bug-out.ts --execute  # real
//
// Idempotent: skips files whose (target, title) already exists, so re-running
// after a crash resumes from where it left off.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { put } from '@vercel/blob'
import { eq, and } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { users, categories, subcategories, notes, files } from '../src/lib/db/schema'
import { encrypt } from '../src/lib/crypto'
import { formatBytes } from '../src/lib/format'

// ─── Config ───────────────────────────────────────────────────────────────────

const SOURCE_ROOT = String.raw`C:\Users\lance\Documents\4625 Forest Place\Bug Out Folder`
const LANCE_EMAIL = 'lance.climb@gmail.com'
const EOTW_SLUG = 'end-of-the-world'

const SKIP_EXTENSIONS = new Set(['.psd', '.pub', '.ffs_db', '.img', '.db'])
const KEEP_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.mp4', '.mov', '.m4v',
  '.zip', '.xlsx', '.xls',
])

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
}

// New subcategories to create under End-of-the-World, in display order.
// Source-folder name → subcategory name + slug.
const EOTW_SUBCATS: { folder: string; name: string; slug: string }[] = [
  { folder: 'Autos',           name: 'Autos',         slug: 'eotw-autos' },
  { folder: 'Checklists',      name: 'Checklists',    slug: 'eotw-checklists' },
  { folder: 'Family Docs',     name: 'Family Docs',   slug: 'eotw-family-docs' },
  { folder: 'Firearms',        name: 'Firearms',      slug: 'eotw-firearms' },
  { folder: 'Food & Water',    name: 'Food & Water',  slug: 'eotw-food-water' },
  { folder: 'Garden',          name: 'Garden',        slug: 'eotw-garden' },
  { folder: 'Home',            name: 'Home',          slug: 'eotw-home' },
  { folder: 'Medical',         name: 'Medical',       slug: 'eotw-medical' },
  { folder: 'Red Folder',      name: 'Red Folder',    slug: 'eotw-red-folder' },
  { folder: 'SHTF Info',       name: 'SHTF Info',     slug: 'eotw-shtf-info' },
  { folder: 'Solar & Power',   name: 'Solar & Power', slug: 'eotw-solar' },
  { folder: '__MISC__',        name: 'Misc',          slug: 'eotw-misc' },
]

// Routing rules for sensitive items. First match wins. Each rule looks for a
// case-insensitive substring in the file's path-relative-to-source.
// Targets are (categoryId-by-slug, subcategoryName) lookups resolved at runtime.
type Route = { test: (pathLower: string) => boolean; categorySlug: string; subcategoryName: string }
const ROUTES: Route[] = [
  // Banks & Investments
  { test: (p) => /family docs[\\/]banks & investments[\\/]banks/.test(p), categorySlug: 'finance', subcategoryName: 'Checking & Saving Banks' },
  { test: (p) => /tda accounts/.test(p), categorySlug: 'finance', subcategoryName: 'Checking & Saving Banks' },
  { test: (p) => /529|path2college|ira docs/.test(p), categorySlug: 'finance', subcategoryName: 'Investments' },
  // Insurance — both home/life policies and the auto-insurance card
  { test: (p) => /family docs[\\/]insurance[\\/]/.test(p), categorySlug: 'finance', subcategoryName: 'Insurance' },
  { test: (p) => /usaa ins cards/.test(p), categorySlug: 'finance', subcategoryName: 'Insurance' },
  // Credit-card photos (in JPEGs/ and Pics/)
  { test: (p) => /credit cards/.test(p), categorySlug: 'finance', subcategoryName: 'Credit Cards' },
  { test: (p) => /pics[\\/](amex|bofa|bk |bk-|bk_|cap |disc |discover|redcard|suntrust|td |synch|nord|stash|fid |fidelity)/.test(p), categorySlug: 'finance', subcategoryName: 'Credit Cards' },
  // Family ID Documents
  { test: (p) => /(lance cobb dl|makenzie paiton id cards)/.test(p), categorySlug: 'kids', subcategoryName: 'ID Documents' },
  { test: (p) => /family docs[\\/](lance|heather|makenzie|paiton|sydney|tadan) info\.pdf/.test(p), categorySlug: 'kids', subcategoryName: 'ID Documents' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  srcPath: string         // absolute file path
  relPath: string         // path relative to SOURCE_ROOT, posix-style
  filename: string        // basename
  ext: string             // lowercase extension, with dot
  size: number            // bytes
  mimeType: string
  title: string           // basename without extension
  categoryId: string
  subcategoryId: string | null
  targetLabel: string     // for display, e.g. "end-of-the-world > Firearms"
}

// ─── File walking ─────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) }
    catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) out.push(full)
    }
  }
  return out
}

function topLevelFolder(relPath: string): string {
  // relPath like "Cobb Family Bug Out Info & How To's/Firearms/How To's/foo.pdf"
  // or "Solar/whatever.pdf" or just "Ammo Boxes.docx"
  const parts = relPath.split('/')
  if (parts.length === 1) return '__MISC__'   // root-level files
  // Drill into "Cobb Family Bug Out Info & How To's" if that's the first segment
  if (parts[0].startsWith('Cobb Family')) {
    return parts.length >= 2 ? parts[1] : '__MISC__'
  }
  // Top-level Solar/ folds into Solar & Power
  if (parts[0] === 'Solar') return 'Solar & Power'
  return parts[0]
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const execute = process.argv.includes('--execute')

  // 1. Look up Lance
  const lance = await db.select().from(users).where(eq(users.email, LANCE_EMAIL)).then((r) => r[0])
  if (!lance) {
    console.error(`User ${LANCE_EMAIL} not found in DB.`)
    process.exit(1)
  }

  // 2. Look up End-of-the-World category
  const eotw = await db.select().from(categories).where(eq(categories.slug, EOTW_SLUG)).then((r) => r[0])
  if (!eotw) {
    console.error(`Category ${EOTW_SLUG} not found in DB.`)
    process.exit(1)
  }

  // 3. Build category/subcategory lookups for routing
  const allCats = await db.select().from(categories)
  const allSubs = await db.select().from(subcategories)
  const catBySlug = new Map(allCats.map((c) => [c.slug, c]))
  // (categoryId, subcategoryName) → subcategory
  const subByCatAndName = new Map<string, typeof allSubs[number]>()
  for (const s of allSubs) subByCatAndName.set(`${s.categoryId}::${s.name.toLowerCase()}`, s)

  // 4. Resolve EOTW subcategories — note any that already exist (idempotent
  //    re-runs reuse them). Build a slug map for the new ones.
  const eotwSubBySlug = new Map<string, typeof allSubs[number]>()
  for (const s of allSubs) if (s.categoryId === eotw.id) eotwSubBySlug.set(s.slug, s)

  // 5. Walk and plan
  console.log(`Scanning ${SOURCE_ROOT} ...`)
  const allPaths = walk(SOURCE_ROOT)
  console.log(`Found ${allPaths.length} files.`)

  const plans: Plan[] = []
  const skippedExt: { path: string; ext: string }[] = []
  const unrouted: string[] = []

  // Existing subcategory ids by EOTW folder name (created if needed)
  const eotwFolderToSubId = new Map<string, string | null>()
  for (const def of EOTW_SUBCATS) {
    const existing = eotwSubBySlug.get(def.slug)
    eotwFolderToSubId.set(def.folder, existing?.id ?? null) // null = needs creation
  }

  for (const srcPath of allPaths) {
    const ext = path.extname(srcPath).toLowerCase()
    if (SKIP_EXTENSIONS.has(ext) || !KEEP_EXTENSIONS.has(ext)) {
      skippedExt.push({ path: srcPath, ext })
      continue
    }

    const filename = path.basename(srcPath)
    const title = filename.slice(0, filename.length - ext.length).trim()
    const stat = fs.statSync(srcPath)
    const relPath = path.relative(SOURCE_ROOT, srcPath).split(path.sep).join('/')
    const relLower = relPath.toLowerCase()

    // Try sensitive-item routes first
    let categoryId: string | null = null
    let subcategoryId: string | null = null
    let targetLabel = ''
    for (const r of ROUTES) {
      if (!r.test(relLower)) continue
      const cat = catBySlug.get(r.categorySlug)
      const sub = cat ? subByCatAndName.get(`${cat.id}::${r.subcategoryName.toLowerCase()}`) : undefined
      if (cat && sub) {
        categoryId = cat.id
        subcategoryId = sub.id
        targetLabel = `${cat.slug} > ${sub.name}`
        break
      } else {
        unrouted.push(`${relPath}  (rule matched but ${r.categorySlug} > ${r.subcategoryName} not found in DB — falling back to EOTW)`)
      }
    }

    // Fall back to EOTW subcategories
    if (!categoryId) {
      const folder = topLevelFolder(relPath)
      const def = EOTW_SUBCATS.find((d) => d.folder === folder) ?? EOTW_SUBCATS.find((d) => d.folder === '__MISC__')!
      categoryId = eotw.id
      subcategoryId = eotwFolderToSubId.get(def.folder) ?? null  // may be null until --execute creates it
      targetLabel = `${eotw.slug} > ${def.name}`
    }

    plans.push({
      srcPath,
      relPath,
      filename,
      ext,
      size: stat.size,
      mimeType: MIME[ext] ?? 'application/octet-stream',
      title,
      categoryId,
      subcategoryId,
      targetLabel,
    })
  }

  // 6. Print summary
  const byTarget = new Map<string, { count: number; bytes: number }>()
  let totalBytes = 0
  for (const p of plans) {
    totalBytes += p.size
    const cur = byTarget.get(p.targetLabel) ?? { count: 0, bytes: 0 }
    cur.count += 1
    cur.bytes += p.size
    byTarget.set(p.targetLabel, cur)
  }
  const sortedTargets = [...byTarget.entries()].sort((a, b) => b[1].count - a[1].count)

  const labelWidth = Math.max(...sortedTargets.map(([t]) => t.length), 30)

  console.log()
  console.log(execute ? 'EXECUTING import' : 'DRY RUN — no changes will be made')
  console.log('─'.repeat(60))
  console.log(`Will create ${EOTW_SUBCATS.filter((d) => !eotwSubBySlug.has(d.slug)).length} new subcategories under ${eotw.slug}.`)
  console.log(`Will upload ${plans.length} files (${formatBytes(totalBytes)}).`)
  console.log()
  for (const [label, stats] of sortedTargets) {
    console.log(`  ${label.padEnd(labelWidth)}  ${String(stats.count).padStart(4)} files · ${formatBytes(stats.bytes)}`)
  }
  console.log()
  console.log(`Skipped (.psd / .pub / .ffs_db / system): ${skippedExt.length}`)
  if (unrouted.length > 0) {
    console.log()
    console.log(`Routing fallbacks (${unrouted.length}):`)
    for (const u of unrouted.slice(0, 10)) console.log(`  ${u}`)
    if (unrouted.length > 10) console.log(`  ... and ${unrouted.length - 10} more`)
  }

  if (!execute) {
    console.log()
    console.log('Run with --execute to actually create subcategories, upload blobs, and insert notes.')
    process.exit(0)
  }

  // ─── EXECUTE ───────────────────────────────────────────────────────────────

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Missing BLOB_READ_WRITE_TOKEN — cannot upload blobs. Aborting.')
    process.exit(1)
  }

  // 7. Create missing EOTW subcategories
  console.log()
  console.log('Creating subcategories...')
  for (let i = 0; i < EOTW_SUBCATS.length; i++) {
    const def = EOTW_SUBCATS[i]
    if (eotwSubBySlug.has(def.slug)) {
      eotwFolderToSubId.set(def.folder, eotwSubBySlug.get(def.slug)!.id)
      continue
    }
    const [created] = await db.insert(subcategories).values({
      categoryId: eotw.id,
      name: def.name,
      slug: def.slug,
      sortOrder: i * 10,
    }).returning()
    eotwFolderToSubId.set(def.folder, created.id)
    console.log(`  + ${def.slug}  ${created.id}`)
  }

  // 8. Re-resolve any plans whose subcategoryId was null (newly-created EOTW subs)
  for (const p of plans) {
    if (p.subcategoryId) continue
    const def = EOTW_SUBCATS.find((d) => `${eotw.slug} > ${d.name}` === p.targetLabel)
    if (def) p.subcategoryId = eotwFolderToSubId.get(def.folder) ?? null
  }

  // 9. Build dedupe set: existing notes in any of our target buckets
  const targetCatSubKeys = new Set<string>()
  for (const p of plans) targetCatSubKeys.add(`${p.categoryId}::${p.subcategoryId ?? 'null'}`)

  const existingNotes = await db.select({
    title: notes.title,
    categoryId: notes.categoryId,
    subcategoryId: notes.subcategoryId,
  }).from(notes)

  const existingTitles = new Set<string>()
  for (const n of existingNotes) {
    const key = `${n.categoryId}::${n.subcategoryId ?? 'null'}`
    if (targetCatSubKeys.has(key)) {
      existingTitles.add(`${key}::${n.title.toLowerCase()}`)
    }
  }

  // 10. Upload + insert each file
  console.log()
  console.log(`Uploading ${plans.length} files (sequential)...`)
  let uploaded = 0
  let skippedDup = 0
  const failures: { path: string; err: string }[] = []

  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    const dedupKey = `${p.categoryId}::${p.subcategoryId ?? 'null'}::${p.title.toLowerCase()}`
    if (existingTitles.has(dedupKey)) {
      skippedDup++
      continue
    }

    const num = `[${(i + 1).toString().padStart(4)}/${plans.length}]`
    try {
      const buf = fs.readFileSync(p.srcPath)
      // Sanitize the name segment used in the blob path (the DB row keeps the
      // original filename for display).
      const safeName = p.filename.replace(/[^A-Za-z0-9._-]/g, '_')
      const blobPath = `vault/${lance.id}/import-bug-out/${Date.now()}-${safeName}`
      const blob = await put(blobPath, buf, { access: 'private', contentType: p.mimeType, allowOverwrite: true })

      const content = `Imported from: ${p.relPath}`
      const [createdNote] = await db.insert(notes).values({
        categoryId: p.categoryId,
        subcategoryId: p.subcategoryId,
        title: p.title,
        content: encrypt(content) ?? '',
        isPrivate: false,
        isPersonal: false,
        isFavorite: false,
        createdBy: lance.id,
        updatedBy: lance.id,
      }).returning()

      await db.insert(files).values({
        noteId: createdNote.id,
        filename: p.filename,
        blobUrl: blob.url,
        contentType: p.mimeType,
        size: p.size,
        isPrivate: false,
        uploadedBy: lance.id,
      })

      existingTitles.add(dedupKey)
      uploaded++
      console.log(`${num} ${p.relPath}  →  ${p.targetLabel}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ path: p.relPath, err: msg })
      console.error(`${num} FAILED  ${p.relPath}  →  ${msg}`)
    }
  }

  console.log()
  console.log('─'.repeat(60))
  console.log(`Uploaded:        ${uploaded}`)
  console.log(`Skipped (dup):   ${skippedDup}`)
  console.log(`Failed:          ${failures.length}`)
  if (failures.length > 0) {
    console.log()
    console.log('Failures:')
    for (const f of failures) console.log(`  ${f.path}  →  ${f.err}`)
    process.exit(1)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
