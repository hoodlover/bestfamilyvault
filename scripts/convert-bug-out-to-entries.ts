// Converts the bug-out import's "one note per file" structure into proper
// document entries. Each note in the End-of-the-World category gets its
// attached file(s) re-bound to a fresh entry of type='document', the entry
// title is a cleaned-up version of the filename, and the now-empty note
// is deleted. Provenance ("Imported from: …") moves into the entry's
// noteContent.
//
//   npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts            # dry-run
//   npx tsx --env-file=.env.local scripts/convert-bug-out-to-entries.ts --execute  # commit
//
// Idempotent in the loose sense: notes without an attached file are
// skipped. After a successful conversion the source note is gone, so
// re-running is safe — there's nothing left to convert.

import { eq, inArray } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { notes, entries, files, categories, users } from '../src/lib/db/schema'
import { encrypt, decryptNote } from '../src/lib/crypto'

const LANCE_EMAIL = 'lance.climb@gmail.com'
const EOTW_SLUG = 'end-of-the-world'

// Cleans a filename into a polished entry title. Conservative — preserves
// existing word casing (so "Glock 42 Gen 4 .380 ACP" stays put) but swaps
// dashes/underscores for spaces and capitalizes the first letter. Adds
// type-aware suffixes for media so a folder of mixed videos and PDFs
// doesn't read like 50 indistinguishable rows.
function cleanTitle(filename: string, contentType: string): string {
  const ext = filename.match(/\.[^.]+$/)?.[0] ?? ''
  let title = filename.slice(0, -ext.length)

  // Underscores → spaces. Dashes too, except when between digits (e.g. dates).
  title = title.replace(/_/g, ' ')
  title = title.replace(/(?<!\d)-(?!\d)/g, ' ')
  title = title.replace(/\s+/g, ' ').trim()

  // Sentence-case the first letter; leave the rest of the casing alone.
  if (title.length > 0) title = title.charAt(0).toUpperCase() + title.slice(1)

  // A handful of small fixups to make titles read more naturally.
  title = title
    .replace(/\bShtf\b/g, 'SHTF')
    .replace(/\bPdf\b/g, 'PDF')
    .replace(/\bAr15\b/g, 'AR-15')
    .replace(/\bAr 15\b/g, 'AR-15')
    .replace(/\bM&p\b/g, 'M&P')
    .replace(/\bSpl\b/g, 'SPL')
    .replace(/\bAcp\b/g, 'ACP')
    .replace(/\bMoa\b/g, 'MOA')
    .replace(/\bMil\b/g, 'MIL')
    .replace(/\bUsaa\b/g, 'USAA')
    .replace(/\bFema\b/g, 'FEMA')
    .replace(/\bGa\b/g, 'GA') // 12 GA shotgun

  if (contentType.startsWith('video/')) {
    if (!/\bvideo\b/i.test(title)) title += ' (Video)'
  } else if (contentType.startsWith('image/')) {
    // Receipts / ID scans are images but reading "Lance Cobb DL Front (Photo)"
    // adds clarity; reading "Heather Carry 2023 (Photo)" doesn't add much
    // either way. Append for everything image except gif.
    if (!/(photo|image|scan|receipt)/i.test(title) && !ext.match(/\.gif$/i)) {
      title += ' (Photo)'
    }
  }

  return title
}

async function main() {
  const execute = process.argv.includes('--execute')

  const lance = await db.select().from(users).where(eq(users.email, LANCE_EMAIL)).then((r) => r[0])
  if (!lance) {
    console.error(`User ${LANCE_EMAIL} not found.`)
    process.exit(1)
  }

  const eotw = await db.select().from(categories).where(eq(categories.slug, EOTW_SLUG)).then((r) => r[0])
  if (!eotw) {
    console.error(`Category ${EOTW_SLUG} not found.`)
    process.exit(1)
  }

  const eotwNotes = await db.select().from(notes).where(eq(notes.categoryId, eotw.id))
  console.log(`Found ${eotwNotes.length} notes in End of the World.`)

  const noteIds = eotwNotes.map((n) => n.id)
  const allFiles = noteIds.length
    ? await db.select().from(files).where(inArray(files.noteId, noteIds))
    : []
  const filesByNote = new Map<string, typeof allFiles>()
  for (const f of allFiles) {
    if (!f.noteId) continue
    const arr = filesByNote.get(f.noteId) ?? []
    arr.push(f)
    filesByNote.set(f.noteId, arr)
  }

  type Plan = { note: typeof eotwNotes[number]; files: typeof allFiles; newTitle: string }
  const plans: Plan[] = []
  let skipNoFile = 0

  for (const note of eotwNotes) {
    const noteFiles = filesByNote.get(note.id) ?? []
    if (noteFiles.length === 0) { skipNoFile++; continue }
    // The "primary" file drives the title. If there are multiple files, they
    // all attach to the same new entry — which is rare in the import but
    // worth supporting for any manual edits Lance has done.
    const primary = noteFiles[0]
    const newTitle = cleanTitle(primary.filename, primary.contentType)
    plans.push({ note, files: noteFiles, newTitle })
  }

  console.log(`Will convert: ${plans.length}`)
  console.log(`Skipped (no attached file): ${skipNoFile}`)

  // Show a sample so Lance can eyeball the title cleanup
  console.log('\nSample (first 15):')
  for (const p of plans.slice(0, 15)) {
    console.log(`  ${p.note.title.padEnd(60)}  →  ${p.newTitle}`)
  }
  if (plans.length > 15) console.log(`  …and ${plans.length - 15} more.`)

  if (!execute) {
    console.log('\nRun with --execute to actually convert (will delete source notes).')
    process.exit(0)
  }

  console.log(`\nConverting ${plans.length} notes…`)
  let ok = 0
  const failures: { title: string; err: string }[] = []
  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    const num = `[${(i + 1).toString().padStart(4)}/${plans.length}]`
    try {
      // Notes' categoryId is nullable in the schema; entries' is NOT NULL.
      // We filtered to EOTW notes by category earlier so this should never
      // hit, but the type system doesn't know that — fall back to the EOTW
      // category id if somehow null.
      const targetCategoryId = p.note.categoryId ?? eotw.id

      const decrypted = decryptNote(p.note)
      const noteContent = decrypted.content || ''

      const [entry] = await db.insert(entries).values({
        categoryId: targetCategoryId,
        subcategoryId: p.note.subcategoryId,
        type: 'document',
        title: p.newTitle,
        noteContent: noteContent === '' ? null : encrypt(noteContent),
        isPrivate: p.note.isPrivate,
        isPersonal: p.note.isPersonal,
        isFavorite: false,
        createdBy: lance.id,
        updatedBy: lance.id,
      }).returning()

      for (const f of p.files) {
        await db.update(files)
          .set({ entryId: entry.id, noteId: null })
          .where(eq(files.id, f.id))
      }

      await db.delete(notes).where(eq(notes.id, p.note.id))
      ok++
      console.log(`${num} ${p.newTitle}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push({ title: p.note.title, err: msg })
      console.error(`${num} FAILED  ${p.note.title}  →  ${msg}`)
    }
  }

  console.log()
  console.log(`Converted: ${ok}`)
  console.log(`Failed:    ${failures.length}`)
  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  ${f.title}  →  ${f.err}`)
    process.exit(1)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
