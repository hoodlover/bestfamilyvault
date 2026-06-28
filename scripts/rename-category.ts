// Rename a category in the DB. Useful when a category was created via the
// admin UI with a long display name and you want to shorten it without
// hunting around for the right edit button on a small screen. Slug stays
// the same so existing /categories/<slug> links keep working.
//
// Usage:
//   Dry-run (default):
//     npx tsx --env-file=.env.local scripts/rename-category.ts "Old Name" "New Name"
//   Apply:
//     npx tsx --env-file=.env.local scripts/rename-category.ts "Old Name" "New Name" --apply
//
// Match is case-insensitive on the existing name. If multiple categories
// match, you'll see them listed and nothing changes — refine the search.

import { eq, ilike } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { categories } from '../src/lib/db/schema'

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--apply')
  const apply = process.argv.includes('--apply')
  const [oldName, newName] = args

  if (!oldName || !newName) {
    console.error('Usage: npx tsx --env-file=.env.local scripts/rename-category.ts "Old Name" "New Name" [--apply]')
    process.exit(1)
  }

  const matches = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(ilike(categories.name, oldName))

  if (matches.length === 0) {
    console.error(`No category named "${oldName}" (case-insensitive) found.`)
    process.exit(1)
  }
  if (matches.length > 1) {
    console.error(`Multiple categories match "${oldName}":`)
    for (const m of matches) console.error(`  - ${m.name} (slug=${m.slug})`)
    console.error('Refine the search.')
    process.exit(1)
  }

  const target = matches[0]
  console.log(`Found: ${target.name} (slug=${target.slug})`)
  console.log(`Will rename to: ${newName}`)

  if (!apply) {
    console.log('\nDry-run — re-run with --apply to write the change.')
    return
  }

  await db.update(categories).set({ name: newName }).where(eq(categories.id, target.id))
  console.log('\nDone.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
