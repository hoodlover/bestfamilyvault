// Reconciles category.icon and subcategory.icon DB fields against the
// actual icon files on disk under public/icons/.
//
//   - If a row's icon points at a file that no longer exists, NULL out
//     that row's icon column. The presentation layer falls back to the
//     category-default rules (src/lib/category-presentation.ts).
//   - Reports counts at the end so you can see what was cleaned.
//
// Run:  npx tsx --env-file=.env.local scripts/sync-icons-db.ts
//
// Safe to re-run any time. Doesn't write category icons that were
// already healthy. Doesn't auto-assign icons to rows with NULL — those
// stay NULL and the admin picks via the UI.

import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'

const PROJECT_ROOT = process.cwd()
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public')

function iconFileExists(iconPath: string): boolean {
  // DB stores URL-style paths like '/icons/cobb/icons/system/foo.png'.
  // Map to filesystem under public/.
  const cleaned = iconPath.replace(/^\//, '')
  // Skip non-local URLs (http://, blob://, etc.) — those aren't our
  // problem to validate from disk.
  if (/^https?:\/\//.test(iconPath) || iconPath.startsWith('data:')) return true
  const fullPath = path.join(PUBLIC_DIR, cleaned)
  return fs.existsSync(fullPath)
}

async function main() {
  console.log(`Reconciling icon paths in DB against ${PUBLIC_DIR}\n`)

  const allCategories = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug, icon: categories.icon })
    .from(categories)

  let catCleaned = 0
  let catHealthy = 0
  let catEmpty = 0

  for (const c of allCategories) {
    if (!c.icon) {
      catEmpty++
      continue
    }
    if (iconFileExists(c.icon)) {
      catHealthy++
    } else {
      console.log(`  ✗ Category "${c.name}" (${c.slug}) → ${c.icon} missing — clearing`)
      await db.update(categories).set({ icon: null }).where(eq(categories.id, c.id))
      catCleaned++
    }
  }

  console.log()

  const allSubs = await db
    .select({ id: subcategories.id, name: subcategories.name, icon: subcategories.icon, categoryId: subcategories.categoryId })
    .from(subcategories)

  const catName = new Map(allCategories.map((c) => [c.id, c.name]))

  let subCleaned = 0
  let subHealthy = 0
  let subEmpty = 0

  for (const s of allSubs) {
    if (!s.icon) {
      subEmpty++
      continue
    }
    if (iconFileExists(s.icon)) {
      subHealthy++
    } else {
      console.log(`  ✗ Subcategory "${s.name}" under "${catName.get(s.categoryId) ?? '?'}" → ${s.icon} missing — clearing`)
      await db.update(subcategories).set({ icon: null }).where(eq(subcategories.id, s.id))
      subCleaned++
    }
  }

  console.log()
  console.log('Categories:')
  console.log(`  Healthy:   ${catHealthy}`)
  console.log(`  Cleared:   ${catCleaned}`)
  console.log(`  No icon:   ${catEmpty}`)
  console.log()
  console.log('Subcategories:')
  console.log(`  Healthy:   ${subHealthy}`)
  console.log(`  Cleared:   ${subCleaned}`)
  console.log(`  No icon:   ${subEmpty}`)
  console.log()
  console.log(`Done. ${catCleaned + subCleaned} broken icon paths cleared.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })
