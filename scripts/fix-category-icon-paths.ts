// One-shot: walk every category + subcategory icon URL in the DB and
// reconcile it against the current on-disk layout.
//
// Two-pass:
//   1) Apply explicit overrides for the categories whose presets changed
//      (auto → dog_truck_road, entertainment/tech → connected_devices).
//   2) For everything else, if the recorded path doesn't exist on disk,
//      find a file with the same basename anywhere under
//      public/icons/cobb/icons/** and repoint to the new location. Skip if
//      the basename is missing or ambiguous (multiple matches) — those get
//      logged so Lance can resolve manually.
//
// Run with: npx tsx --env-file=.env.local scripts/fix-category-icon-paths.ts

import { neon } from '@neondatabase/serverless'
import { existsSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'

const sql = neon(process.env.DATABASE_URL!)

const PUBLIC_ROOT = path.resolve('public')
const ICON_ROOT = path.resolve('public/icons/cobb/icons')

// Explicit overrides for category slugs whose presets changed.
const EXPLICIT_CATEGORY: Record<string, string> = {
  auto: '/icons/cobb/icons/system/dog_truck_road.png',
  entertainment: '/icons/cobb/icons/tech/connected_devices.png',
  tech: '/icons/cobb/icons/tech/connected_devices.png',
}

function urlToFsPath(url: string): string {
  return path.join(PUBLIC_ROOT, url.replace(/^\/+/, ''))
}

function fsPathToUrl(fsPath: string): string {
  const rel = path.relative(PUBLIC_ROOT, fsPath)
  return `/${rel.split(path.sep).join('/')}`
}

// Build a basename → [absolute paths] index of every icon under ICON_ROOT.
function indexIcons(): Map<string, string[]> {
  const index = new Map<string, string[]>()
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile()) {
        const base = name
        const arr = index.get(base) ?? []
        arr.push(full)
        index.set(base, arr)
      }
    }
  }
  walk(ICON_ROOT)
  return index
}

interface Resolution {
  newUrl: string | null
  reason: 'explicit' | 'unchanged' | 'remapped' | 'missing' | 'ambiguous' | 'external'
  matches?: string[]
}

function resolveIcon(currentUrl: string | null, slug: string | null, index: Map<string, string[]>): Resolution {
  if (slug && EXPLICIT_CATEGORY[slug]) {
    return { newUrl: EXPLICIT_CATEGORY[slug], reason: 'explicit' }
  }
  if (!currentUrl) return { newUrl: null, reason: 'unchanged' }
  // Don't touch absolute http(s) URLs (uploaded blobs).
  if (/^https?:\/\//i.test(currentUrl)) return { newUrl: currentUrl, reason: 'external' }
  // Don't touch URLs outside the icons tree (parent /icons/cobb/*.png originals).
  if (!currentUrl.startsWith('/icons/cobb/')) return { newUrl: currentUrl, reason: 'external' }

  if (existsSync(urlToFsPath(currentUrl))) {
    return { newUrl: currentUrl, reason: 'unchanged' }
  }

  const base = path.basename(currentUrl)
  const matches = index.get(base) ?? []
  if (matches.length === 0) return { newUrl: null, reason: 'missing' }
  if (matches.length > 1) return { newUrl: fsPathToUrl(matches[0]), reason: 'ambiguous', matches }
  return { newUrl: fsPathToUrl(matches[0]), reason: 'remapped' }
}

async function run() {
  const index = indexIcons()
  console.log(`Indexed ${[...index.values()].reduce((a, v) => a + v.length, 0)} icon files under ${ICON_ROOT}\n`)

  let updated = 0
  let cleared = 0
  let unchanged = 0
  let ambiguous = 0

  // Categories
  const cats = await sql`SELECT id, slug, name, icon FROM category` as Array<{ id: string; slug: string; name: string; icon: string | null }>
  console.log('=== CATEGORIES ===')
  for (const c of cats) {
    const res = resolveIcon(c.icon, c.slug, index)
    if (res.reason === 'unchanged' || res.reason === 'external') {
      unchanged++
      continue
    }
    if (res.reason === 'missing') {
      console.log(`  [missing] ${c.slug}: ${c.icon} → NULL (no basename match)`)
      await sql`UPDATE category SET icon = NULL WHERE id = ${c.id}`
      cleared++
      continue
    }
    if (res.reason === 'ambiguous') {
      ambiguous++
      console.log(`  [ambiguous] ${c.slug}: ${c.icon} → ${res.newUrl} (also matched: ${res.matches?.slice(1).map(fsPathToUrl).join(', ')})`)
    }
    if (res.newUrl !== c.icon) {
      const tag = res.reason === 'explicit' ? 'explicit' : 'remap'
      console.log(`  [${tag}] ${c.slug}: ${c.icon ?? '(null)'} → ${res.newUrl}`)
      await sql`UPDATE category SET icon = ${res.newUrl} WHERE id = ${c.id}`
      updated++
    }
  }

  // Subcategories — no explicit overrides, just remap.
  const subs = await sql`SELECT id, name, icon FROM subcategory` as Array<{ id: string; name: string; icon: string | null }>
  console.log('\n=== SUBCATEGORIES ===')
  for (const s of subs) {
    const res = resolveIcon(s.icon, null, index)
    if (res.reason === 'unchanged' || res.reason === 'external') {
      unchanged++
      continue
    }
    if (res.reason === 'missing') {
      console.log(`  [missing] ${s.name}: ${s.icon} → NULL`)
      await sql`UPDATE subcategory SET icon = NULL WHERE id = ${s.id}`
      cleared++
      continue
    }
    if (res.reason === 'ambiguous') {
      ambiguous++
      console.log(`  [ambiguous] ${s.name}: ${s.icon} → ${res.newUrl} (also matched: ${res.matches?.slice(1).map(fsPathToUrl).join(', ')})`)
    }
    if (res.newUrl !== s.icon) {
      console.log(`  [remap] ${s.name}: ${s.icon ?? '(null)'} → ${res.newUrl}`)
      await sql`UPDATE subcategory SET icon = ${res.newUrl} WHERE id = ${s.id}`
      updated++
    }
  }

  console.log(`\nDone. Updated: ${updated}, cleared: ${cleared}, unchanged: ${unchanged}, ambiguous: ${ambiguous}`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
