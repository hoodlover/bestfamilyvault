// One-shot normalizer for note content that came in from imports with
// excessive whitespace — long stretches of blank lines that made the
// editor scroll on and on while the card preview (stripHtml-collapsed)
// looked deceptively compact. Lance flagged "Sydney Info" as a typical
// example.
//
// Normalization rules (in order):
//   1. CRLF / CR  → LF  (Windows / old-Mac line endings → Unix)
//   2. Trim trailing whitespace from every line.
//   3. Collapse runs of 3+ consecutive newlines down to 2 — keeps real
//      paragraph breaks, drops the runaway spacing.
//   4. Trim leading/trailing whitespace from the whole content.
//
// HTML notes (Tiptap-authored content that wraps lines in <p>/<br>) are
// skipped — those have intentional structure we don't want to mangle.
// Detection: presence of any of the same HTML tags rich-text-display.tsx
// looks for. Conservative match — false positives only mean we skip a
// note that was technically plain-text.
//
// Default: DRY RUN. Pass `--apply` to actually write changes. Always
// prints the before/after diff stats and a per-note breakdown.
//
// Run:
//   npx tsx --env-file=.env.local scripts/normalize-note-whitespace.ts
//   npx tsx --env-file=.env.local scripts/normalize-note-whitespace.ts --apply

import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { notes, categories } from '../src/lib/db/schema'
import { decrypt, encrypt } from '../src/lib/crypto'

const APPLY = process.argv.includes('--apply')

const HTML_TAG_RE = /<\/(p|div|ul|ol|li|h[1-6]|blockquote|pre|code|br|strong|em|u|mark|span|a|table|tr|td|th)\b[^>]*>/i
function looksLikeHtml(s: string): boolean {
  return HTML_TAG_RE.test(s) || /<br\s*\/?\s*>/i.test(s)
}

function normalize(content: string): string {
  let out = content
  // CRLF + CR → LF
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Trim trailing whitespace on each line (preserves leading indent in
  // case it's load-bearing for a list / quote).
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
  // Collapse 3+ consecutive newlines to exactly 2.
  out = out.replace(/\n{3,}/g, '\n\n')
  // Trim overall.
  out = out.trim()
  return out
}

interface Change {
  id: string
  title: string
  category: string | null
  beforeLen: number
  afterLen: number
  beforePreview: string
  afterPreview: string
}

async function main() {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      categoryId: notes.categoryId,
    })
    .from(notes)

  const catRows = await db.select({ id: categories.id, name: categories.name }).from(categories)
  const catName = new Map(catRows.map((c) => [c.id, c.name]))

  console.log(`Scanning ${rows.length} notes…\n`)

  const changes: Change[] = []
  let skippedHtml = 0
  let skippedEmpty = 0
  let skippedNoChange = 0

  for (const row of rows) {
    const decrypted = decrypt(row.content)
    if (!decrypted) {
      skippedEmpty++
      continue
    }
    if (looksLikeHtml(decrypted)) {
      skippedHtml++
      continue
    }
    const normalized = normalize(decrypted)
    if (normalized === decrypted) {
      skippedNoChange++
      continue
    }
    changes.push({
      id: row.id,
      title: row.title,
      category: row.categoryId ? catName.get(row.categoryId) ?? null : null,
      beforeLen: decrypted.length,
      afterLen: normalized.length,
      beforePreview: decrypted.slice(0, 80).replace(/\n/g, '⏎'),
      afterPreview: normalized.slice(0, 80).replace(/\n/g, '⏎'),
    })
  }

  console.log(`Plain-text notes needing normalization: ${changes.length}`)
  console.log(`  HTML notes skipped (Tiptap content):  ${skippedHtml}`)
  console.log(`  Empty notes skipped:                  ${skippedEmpty}`)
  console.log(`  Already-clean notes:                  ${skippedNoChange}`)
  console.log('')

  if (changes.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Per-note breakdown — show how much each one shrinks.
  console.log('Per-note breakdown:')
  console.log('─'.repeat(96))
  for (const c of changes) {
    const delta = c.beforeLen - c.afterLen
    const pct = c.beforeLen > 0 ? Math.round((delta / c.beforeLen) * 100) : 0
    console.log(
      `  [${c.category ?? '—'}] ${c.title}  ${c.beforeLen} → ${c.afterLen} chars (-${delta}, -${pct}%)`
    )
    console.log(`     before: ${c.beforePreview}`)
    console.log(`     after:  ${c.afterPreview}`)
  }
  console.log('─'.repeat(96))

  const totalBefore = changes.reduce((sum, c) => sum + c.beforeLen, 0)
  const totalAfter = changes.reduce((sum, c) => sum + c.afterLen, 0)
  const totalDelta = totalBefore - totalAfter
  const totalPct = totalBefore > 0 ? Math.round((totalDelta / totalBefore) * 100) : 0
  console.log(`\nTotals: ${totalBefore} → ${totalAfter} chars (-${totalDelta}, -${totalPct}%)`)

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to commit.')
    return
  }

  console.log('\nWriting changes…')
  let written = 0
  for (const c of changes) {
    const decrypted = decrypt((await db.select({ content: notes.content }).from(notes).where(eq(notes.id, c.id)).then((r) => r[0]))?.content) ?? ''
    const normalized = normalize(decrypted)
    if (normalized === decrypted) continue // someone edited between scan + write
    await db
      .update(notes)
      .set({
        content: encrypt(normalized) ?? '',
        updatedAt: new Date(),
      })
      .where(eq(notes.id, c.id))
    written++
  }
  console.log(`Wrote ${written} note${written === 1 ? '' : 's'}.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
