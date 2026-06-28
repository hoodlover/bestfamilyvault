// Diagnostic — read the "Local agencies & services" topic's current
// content and report whether the "Preferred funeral home" line still
// has __________ blanks, or whether it carries a saved answer. Settles
// "is my save actually persisting?" without guessing at the UI flow.

import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { eq, and, like } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

async function main() {
  // The "I'm Dead, Now What?" category — primary guide slug.
  const guideCat = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(like(categories.slug, 'now-what%'))
  if (guideCat.length === 0) {
    console.log('❌ No IDNW guide category found.')
    process.exit(1)
  }

  for (const cat of guideCat) {
    console.log(`\n── Category: ${cat.name} (${cat.slug}) ──`)

    const topicRows = await db
      .select({ id: notes.id, title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(eq(notes.categoryId, cat.id), like(notes.title, '%Local agencies%')))

    if (topicRows.length === 0) {
      console.log('  (no "Local agencies & services" topic in this guide)')
      continue
    }

    for (const t of topicRows) {
      console.log(`\n  Topic: ${t.title}`)
      console.log(`  Last updated: ${t.updatedAt?.toISOString() ?? '(never)'}`)
      const plain = decrypt(t.content ?? '') ?? ''
      const funeralLines = plain
        .split('\n')
        .map((line, i) => ({ i, line }))
        .filter((x) => /funeral home/i.test(x.line))

      if (funeralLines.length === 0) {
        console.log('  ⚠ No "funeral home" lines in this topic.')
        continue
      }

      console.log('  Funeral-home lines in current saved content:')
      for (const { i, line } of funeralLines) {
        const hasBlank = /_{3,}/.test(line)
        const marker = hasBlank ? '❌ STILL BLANK' : '✅ filled in'
        console.log(`    L${i + 1} ${marker}:  ${line.trim()}`)
      }

      const totalBlanks = (plain.match(/_{3,}/g) ?? []).length
      console.log(`\n  Topic has ${totalBlanks} blank(s) total across all lines.`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Check failed:', err)
    process.exit(1)
  })
