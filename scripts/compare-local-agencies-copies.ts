// Side-by-side body view of all "Local agencies & services" copies so
// we can pick the keeper before deleting anything.

import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { eq, and, like } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

async function main() {
  const guideCat = await db
    .select({ id: categories.id })
    .from(categories)
    .where(like(categories.slug, 'now-what'))
    .then((r) => r[0])

  if (!guideCat) {
    console.log('No guide category.')
    process.exit(1)
  }

  const rows = await db
    .select({ id: notes.id, content: notes.content, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.categoryId, guideCat.id), like(notes.title, '%Local agencies%')))
    .orderBy(notes.updatedAt)

  for (const r of rows) {
    const plain = decrypt(r.content ?? '') ?? ''
    const lines = plain.split('\n')
    console.log('\n' + '═'.repeat(78))
    console.log(`Copy: ${r.id}`)
    console.log(`Updated: ${r.updatedAt?.toISOString()}`)
    console.log(`Lines: ${lines.length}  Chars: ${plain.length}`)
    console.log('─'.repeat(78))
    // First 40 + last 10 lines so we can see shape without scrolling
    // pages of text in the terminal.
    const head = lines.slice(0, 40).join('\n')
    const tail = lines.length > 50 ? '\n  …\n' + lines.slice(-10).join('\n') : ''
    console.log(head + tail)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
