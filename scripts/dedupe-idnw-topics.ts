// Delete duplicate IDNW guide topics — for each (category, title) group
// with >1 copy, keep the BEST one and drop the rest.
//
// "Best" ranking: prefer copies with fewest unfilled __________ blanks;
// break ties by most recently updated; break further ties by content
// length (longest wins).
//
// Read-only by default — pass --apply to actually delete. Run --apply
// only after a dry run looks sane.

import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { eq, like, inArray } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

const APPLY = process.argv.includes('--apply')

interface Scored {
  id: string
  title: string
  blanks: number
  chars: number
  updatedMs: number
  updatedISO: string
}

function rank(rows: Scored[]): { keep: Scored; drop: Scored[] } {
  // Lowest blanks wins; tie → latest updated; tie → longest content.
  const sorted = [...rows].sort((a, b) =>
    a.blanks - b.blanks
    || b.updatedMs - a.updatedMs
    || b.chars - a.chars,
  )
  const [keep, ...drop] = sorted
  return { keep, drop }
}

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — deletions will run.' : '🔍 Dry-run — pass --apply to actually delete.')

  const guideCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(like(categories.slug, 'now-what%'))

  let toDelete: string[] = []

  for (const cat of guideCats) {
    console.log(`\n── ${cat.name} ──`)
    const rows = await db
      .select({ id: notes.id, title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.categoryId, cat.id))

    const byTitle = new Map<string, Scored[]>()
    for (const r of rows) {
      const plain = decrypt(r.content ?? '') ?? ''
      const scored: Scored = {
        id: r.id,
        title: r.title,
        blanks: (plain.match(/_{3,}/g) ?? []).length,
        chars: plain.length,
        updatedMs: r.updatedAt?.getTime() ?? 0,
        updatedISO: r.updatedAt?.toISOString() ?? '?',
      }
      const list = byTitle.get(r.title) ?? []
      list.push(scored)
      byTitle.set(r.title, list)
    }

    const dupes = [...byTitle.entries()].filter(([, list]) => list.length > 1)
    if (dupes.length === 0) {
      console.log('  ✅ No duplicates.')
      continue
    }

    for (const [title, list] of dupes) {
      const { keep, drop } = rank(list)
      console.log(`\n  "${title}" — ${list.length} copies`)
      console.log(`    KEEP  ${keep.id}  blanks=${keep.blanks}  chars=${keep.chars}  ${keep.updatedISO}`)
      for (const d of drop) {
        console.log(`    DROP  ${d.id}  blanks=${d.blanks}  chars=${d.chars}  ${d.updatedISO}`)
        toDelete.push(d.id)
      }
    }
  }

  if (toDelete.length === 0) {
    console.log('\n✅ Nothing to delete.')
    return
  }

  console.log(`\n${toDelete.length} note row(s) would be deleted.`)

  if (!APPLY) {
    console.log('Re-run with --apply to delete.')
    return
  }

  await db.delete(notes).where(inArray(notes.id, toDelete))
  console.log(`✅ Deleted ${toDelete.length} duplicate topic row(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
