// Backfill entries.createdAt + notes.createdAt from attached file dates.
// Two sources, in priority order:
//
//   1. Image EXIF DateTimeOriginal (most reliable — actual camera capture
//      timestamp, baked into the file at the moment the photo was taken)
//   2. Filename date patterns (YYYY-MM-DD, MM.DD.YY, MM-DD-YYYY,
//      MM_DD_YYYY) — many of Lance's imported files have the date in
//      the filename, e.g. "3.28.21 Rivers Birth Cert.jpg",
//      "2024_FEDERAL_RETURN.pdf", "1.15.21 Sawnee An Clinic.jpeg"
//
// For each entry/note that has at least one attached file:
//   - Find the OLDEST extractable date across all its attached files
//   - If that date is older than the entry's current createdAt, update
//   - Skip otherwise (don't move newer entries backward into the past
//     unless we have good evidence)
//
// Run:
//   npx tsx --env-file=.env.local scripts/backfill-from-files.ts          # dry run
//   npx tsx --env-file=.env.local scripts/backfill-from-files.ts --apply  # commit

import { eq, isNotNull } from 'drizzle-orm'
import exifr from 'exifr'
import { db } from '../src/lib/db/index'
import { entries, notes, files } from '../src/lib/db/schema'

const apply = process.argv.includes('--apply')

const PROJECT_ROOT = process.cwd()

// Try several common date patterns. Returns the LATEST valid date so a
// filename like "2024_FEDERAL_RETURN_2026-04-26_095949.pdf" picks the
// 2026-04-26 (more recent = more likely to be the file's actual date,
// not a tax-year reference).
//
// Wait — for our purposes (backdating to the OLDEST real reference) we
// want the EARLIEST plausible date. For tax docs, 2024 is the tax
// YEAR. For statements, the YYYY-MM-DD is when the statement was
// generated. Hmm. Use earliest — tax-year matches the period of life
// the document is "about", which is closer to "on this day" semantics.
function parseDateFromFilename(filename: string): Date | null {
  const candidates: Date[] = []

  // YYYY-MM-DD or YYYY_MM_DD (anywhere in the name)
  for (const m of filename.matchAll(/\b(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})\b/g)) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2030) {
      candidates.push(d)
    }
  }
  // M.D.YY or M.D.YYYY or M-D-YY  (dot- or dash-separated American-style)
  for (const m of filename.matchAll(/\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{2}|\d{4})\b/g)) {
    let year = parseInt(m[3])
    if (year < 100) year += 2000
    if (year < 2000 || year > 2030) continue
    const month = parseInt(m[1])
    const day = parseInt(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    const d = new Date(year, month - 1, day)
    if (!Number.isNaN(d.getTime())) candidates.push(d)
  }
  // YYYY only (4-digit year, no day) → Jan 1 of that year as a fallback
  for (const m of filename.matchAll(/\b(20\d{2})\b/g)) {
    const year = parseInt(m[1])
    // Only use the bare-year fallback if no day-precision match was
    // found — we'd rather a precise date.
    if (candidates.length === 0 && year >= 2000 && year <= 2030) {
      candidates.push(new Date(year, 0, 1))
    }
  }

  if (candidates.length === 0) return null
  // Earliest plausible date (best signal for "the thing this file is about")
  candidates.sort((a, b) => a.getTime() - b.getTime())
  return candidates[0]
}

async function parseDateFromBlobUrl(blobUrl: string, contentType: string): Promise<Date | null> {
  if (!contentType.startsWith('image/')) return null
  try {
    const res = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    // exifr.parse() returns an object — pick DateTimeOriginal first,
    // then DateTime, then CreateDate.
    const meta = await exifr.parse(buf, { tiff: true, exif: true })
    const candidates = [meta?.DateTimeOriginal, meta?.CreateDate, meta?.DateTime].filter(Boolean) as Date[]
    if (candidates.length === 0) return null
    candidates.sort((a, b) => a.getTime() - b.getTime())
    return candidates[0]
  } catch {
    return null
  }
}

async function main() {
  console.log(`Backfill mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`)

  // ─── Pull every file row + its parent entry/note ────────────────────────
  const allFiles = await db
    .select({
      id: files.id,
      filename: files.filename,
      blobUrl: files.blobUrl,
      contentType: files.contentType,
      entryId: files.entryId,
      noteId: files.noteId,
    })
    .from(files)

  console.log(`Scanning ${allFiles.length} files for dates...`)

  // Group by parent entry/note + collect the earliest date per parent.
  const byEntry = new Map<string, Date>()
  const byNote = new Map<string, Date>()

  let processed = 0
  for (const f of allFiles) {
    processed++
    if (processed % 50 === 0) console.log(`  scanned ${processed}/${allFiles.length}`)
    if (!f.entryId && !f.noteId) continue

    let best: Date | null = null

    // EXIF first (most accurate) — only for images.
    if (f.contentType.startsWith('image/')) {
      best = await parseDateFromBlobUrl(f.blobUrl, f.contentType)
    }
    // Filename fallback for everything (and as a secondary for images
    // missing EXIF).
    if (!best) {
      best = parseDateFromFilename(f.filename)
    }
    if (!best) continue
    // Sanity bounds — anything before 2000 or after today + 1y is
    // suspect.
    const tooEarly = best.getTime() < new Date('2000-01-01').getTime()
    const tooLate = best.getTime() > Date.now() + 365 * 86_400_000
    if (tooEarly || tooLate) continue

    if (f.entryId) {
      const cur = byEntry.get(f.entryId)
      if (!cur || best < cur) byEntry.set(f.entryId, best)
    }
    if (f.noteId) {
      const cur = byNote.get(f.noteId)
      if (!cur || best < cur) byNote.set(f.noteId, best)
    }
  }

  console.log(`\nFound dates for ${byEntry.size} entries, ${byNote.size} notes\n`)

  // ─── Apply to entries ───────────────────────────────────────────────────
  let entryUpdated = 0
  let entrySkipped = 0
  for (const [entryId, date] of byEntry) {
    const cur = await db
      .select({ createdAt: entries.createdAt, title: entries.title })
      .from(entries)
      .where(eq(entries.id, entryId))
      .then((r) => r[0])
    if (!cur) continue
    // Only update if the file's date is OLDER than the entry's current
    // createdAt — don't shove an entry forward in time.
    if (cur.createdAt <= date) {
      entrySkipped++
      continue
    }
    console.log(`  ${apply ? '✓' : '→'} entry "${cur.title}": ${cur.createdAt.toISOString().slice(0, 10)} → ${date.toISOString().slice(0, 10)}`)
    if (apply) {
      await db.update(entries).set({ createdAt: date }).where(eq(entries.id, entryId))
    }
    entryUpdated++
  }

  // ─── Apply to notes ─────────────────────────────────────────────────────
  let noteUpdated = 0
  let noteSkipped = 0
  for (const [noteId, date] of byNote) {
    const cur = await db
      .select({ createdAt: notes.createdAt, title: notes.title })
      .from(notes)
      .where(eq(notes.id, noteId))
      .then((r) => r[0])
    if (!cur) continue
    if (cur.createdAt <= date) {
      noteSkipped++
      continue
    }
    console.log(`  ${apply ? '✓' : '→'} note "${cur.title}": ${cur.createdAt.toISOString().slice(0, 10)} → ${date.toISOString().slice(0, 10)}`)
    if (apply) {
      await db.update(notes).set({ createdAt: date }).where(eq(notes.id, noteId))
    }
    noteUpdated++
  }

  console.log(`\nSummary:`)
  console.log(`  Entries ${apply ? 'updated' : 'would update'}: ${entryUpdated}`)
  console.log(`  Entries skipped (already older or equal): ${entrySkipped}`)
  console.log(`  Notes ${apply ? 'updated' : 'would update'}: ${noteUpdated}`)
  console.log(`  Notes skipped: ${noteSkipped}`)

  if (!apply && (entryUpdated + noteUpdated) > 0) {
    console.log(`\nRe-run with --apply to commit ${entryUpdated + noteUpdated} updates.`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
