// Find duplicate IDNW guide topics — same title appearing in the same
// guide category more than once. Reports counts + which copies have the
// most "answered" content (fewest underscore blanks left). Read-only;
// run dedupe-idnw-topics.ts to actually purge.

import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { eq, like } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

async function main() {
  const guideCats = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(like(categories.slug, 'now-what%'))

  for (const cat of guideCats) {
    console.log(`\n══ ${cat.name} (${cat.slug}) ══`)

    const rows = await db
      .select({ id: notes.id, title: notes.title, content: notes.content, tags: notes.tags, updatedAt: notes.updatedAt })
      .from(notes)
      .where(eq(notes.categoryId, cat.id))
      .orderBy(notes.title)

    // Group by title.
    const byTitle = new Map<string, typeof rows>()
    for (const r of rows) {
      const list = byTitle.get(r.title) ?? []
      list.push(r)
      byTitle.set(r.title, list)
    }

    const dupes = [...byTitle.entries()].filter(([, list]) => list.length > 1)
    if (dupes.length === 0) {
      console.log('  ✅ No duplicate topics in this guide.')
      continue
    }

    console.log(`  ⚠ ${dupes.length} duplicated topic title(s):\n`)
    for (const [title, list] of dupes) {
      console.log(`  · "${title}" — ${list.length} copies:`)
      for (const r of list) {
        const plain = decrypt(r.content ?? '') ?? ''
        const blanks = (plain.match(/_{3,}/g) ?? []).length
        const tags = (r.tags ?? []).join(', ') || '(none)'
        console.log(`      ${r.id}  updated ${r.updatedAt?.toISOString() ?? '?'}  blanks=${blanks}  tags=[${tags}]`)
      }
      console.log('')
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Check failed:', err)
    process.exit(1)
  })
