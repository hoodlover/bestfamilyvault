// Lance asked for a "Cobb Family" subcategory under Receipts so personal
// / household receipts have a home that isn't one of the LLC buckets
// (PtC, PoG, H&L Havens, CFS LLC). Mirrors the LLC subcategory pattern
// but represents "this was personal/family, not a business expense."
//
// Idempotent: skips if a subcategory with this slug already exists
// under Receipts. Dry-run by default. --apply commits.

import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

const APPLY = process.argv.includes('--apply')

const SLUG = 'cobb-family'
const NAME = 'Cobb Family'

async function main() {
  console.log(APPLY ? '🟢 APPLY mode\n' : '🔍 Dry-run — pass --apply to write.\n')

  const receipts = await db.select({ id: categories.id, name: categories.name })
    .from(categories).where(eq(categories.slug, 'receipts')).then((r) => r[0])
  if (!receipts) throw new Error('Receipts category not found.')
  console.log(`Receipts category: ${receipts.name} (${receipts.id})`)

  // Show what's already there so Lance can see the lineup.
  const existing = await db.select({ id: subcategories.id, slug: subcategories.slug, name: subcategories.name })
    .from(subcategories).where(eq(subcategories.categoryId, receipts.id))
  console.log(`\nExisting Receipts subcategories (${existing.length}):`)
  for (const s of existing) console.log(`  ${s.slug.padEnd(28)} → ${s.name}`)

  const dup = existing.find((s) => s.slug === SLUG)
  if (dup) {
    console.log(`\n✓ "${NAME}" already exists (${dup.id}) — nothing to do.`)
    return
  }

  if (!APPLY) {
    console.log(`\nwould CREATE subcategory: slug="${SLUG}", name="${NAME}", under Receipts`)
    console.log('\nRe-run with --apply to write.')
    return
  }

  const [created] = await db.insert(subcategories).values({
    categoryId: receipts.id,
    slug: SLUG,
    name: NAME,
  }).returning({ id: subcategories.id })

  console.log(`\n✅ created: "${NAME}" (id ${created.id}) under Receipts.`)
  console.log('   You can now select "Cobb Family" as the subcategory on /receipts/new.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
