// Undo a specific merge by parent title (or partial match).
// Usage: npx tsx --env-file=.env.local scripts/undo-recent-merges.ts "Path2College" --execute

import { db } from '../src/lib/db/index'
import { entries } from '../src/lib/db/schema'
import { eq, ilike, isNotNull, inArray } from 'drizzle-orm'

const args = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const titleQuery = args.find((a) => !a.startsWith('--'))

async function main() {
  if (!titleQuery) {
    console.log('Usage: tsx undo-recent-merges.ts "<title fragment>" [--execute]')
    process.exit(1)
  }

  const matchedParents = await db
    .select()
    .from(entries)
    .where(ilike(entries.title, `%${titleQuery}%`))

  const parents = matchedParents.filter((e) => !e.parentEntryId)
  if (parents.length === 0) {
    console.log(`No top-level entries match "${titleQuery}".`)
    return
  }

  console.log(`Matching parent(s):`)
  for (const p of parents) {
    console.log(`  ${p.id.slice(0, 8)}  ${p.title}`)
  }

  const parentIds = parents.map((p) => p.id)
  const children = await db
    .select()
    .from(entries)
    .where(inArray(entries.parentEntryId, parentIds))

  if (children.length === 0) {
    console.log('\nThese parents have no children. Nothing to unlink.')
    return
  }

  console.log(`\n${children.length} children to unlink:`)
  for (const c of children) {
    const u = (c.username ?? '-').slice(0, 30)
    console.log(`  └ ${c.title.slice(0, 40).padEnd(40)}  ${u}`)
  }

  if (!EXECUTE) {
    console.log('\nDry run. Re-run with --execute to actually unlink.')
    return
  }

  const ids = children.map((c) => c.id)
  await db.update(entries).set({ parentEntryId: null }).where(inArray(entries.id, ids))
  console.log(`\nUnlinked ${ids.length} children. They are standalone top-level entries again.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
