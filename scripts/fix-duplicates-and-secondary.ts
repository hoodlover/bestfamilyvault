/**
 * Two-phase fix for the Sticky Password import mess:
 *
 * Phase 1 — Dedup: the import ran 3× creating triplicates.
 *   Remove exact dupes (same title + username + password + url), keep oldest.
 *
 * Phase 2 — Secondary logins: original import only took loginLinks[0].
 *   Import credentials [1..n] for accounts with multiple login links.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix-duplicates-and-secondary.ts <path-to-xml> <userEmail> [--dry-run]
 */

import fs from 'fs'
import { XMLParser } from 'fast-xml-parser'
import { db } from '../src/lib/db/index'
import { entries, categories, users } from '../src/lib/db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'

const xmlPath = process.argv[2]
const userEmail = process.argv[3]
const dryRun = process.argv.includes('--dry-run')

if (!xmlPath || !userEmail) {
  console.error('Usage: fix-duplicates-and-secondary.ts <path-to-xml> <userEmail> [--dry-run]')
  process.exit(1)
}

// ─── Parse XML ────────────────────────────────────────────────────────────────

const buf = fs.readFileSync(xmlPath)
const xml = buf.toString('utf16le').replace(/^\uFEFF/, '')

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) =>
    ['Group', 'Login', 'Account', 'Identity', 'CreditCard', 'RoleValue', 'WndExplorer'].includes(name),
})

const doc = parser.parse(xml)
const data = doc?.root?.Database

if (!data) {
  console.error('Could not find <root><Database> in XML')
  process.exit(1)
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// ─── Build group map ──────────────────────────────────────────────────────────

interface StickyGroup { ID: string; Name: string; ParentID: string }
const groupMap = new Map<string, StickyGroup>()
for (const g of toArray<StickyGroup>(data.Groups?.Group)) {
  groupMap.set(String(g.ID), g)
}

const bookmarkGroupCache = new Map<string, boolean>()
function isBookmarkGroup(id: string): boolean {
  if (bookmarkGroupCache.has(id)) return bookmarkGroupCache.get(id)!
  const g = groupMap.get(id)
  if (!g) { bookmarkGroupCache.set(id, false); return false }
  if (g.ParentID === '-3') { bookmarkGroupCache.set(id, true); return true }
  if (g.ParentID === '-5' || g.ParentID === '-1') { bookmarkGroupCache.set(id, false); return false }
  const result = isBookmarkGroup(String(g.ParentID))
  bookmarkGroupCache.set(id, result)
  return result
}

function getGroupChain(id: string): string[] {
  const g = groupMap.get(id)
  if (!g) return []
  const parentId = String(g.ParentID)
  if (parentId === '-5' || parentId === '-1' || parentId === '-3') return [g.Name]
  return [...getGroupChain(parentId), g.Name]
}

function mapGroupToSlug(chain: string[]): { slug: string; isFavorite: boolean } {
  const lc = chain.map((n) => n.toLowerCase())
  const isFavorite = lc.includes('favorites')
  for (const name of lc) {
    if (['finance', 'bills', 'banks', 'cobb money', 'bank'].some((k) => name.includes(k)))
      return { slug: 'finance', isFavorite }
    if (['health', 'medical'].some((k) => name.includes(k)))
      return { slug: 'health', isFavorite }
    if (['entertainment'].some((k) => name.includes(k)))
      return { slug: 'entertainment', isFavorite }
    if (['kids', 'sydney', 'tadan'].some((k) => name.includes(k)))
      return { slug: 'kids', isFavorite }
    if (['auto', 'vehicle', 'car'].some((k) => name.includes(k)))
      return { slug: 'auto', isFavorite }
    if (['travel', 'travel numbers'].some((k) => name.includes(k)))
      return { slug: 'travel', isFavorite }
    if (['nds', 'cfs llc', 'path to change', 'cobb family solutions', 'business'].some((k) => name.includes(k)))
      return { slug: 'business', isFavorite }
  }
  return { slug: 'home', isFavorite }
}

// ─── Build login credentials map ──────────────────────────────────────────────

interface StickyLogin { ID: string; Name: string; RealLogin?: string; Password?: string }
const loginMap = new Map<string, { username: string; password: string }>()
for (const l of toArray<StickyLogin>(data.Logins?.Login)) {
  loginMap.set(String(l.ID), {
    username: l.RealLogin || l.Name || '',
    password: l.Password || '',
  })
}

interface StickyAccount {
  ID: string
  Name: string
  ParentID: string
  Link?: string
  LoginLinks?: { Login: { SourceLoginID: string }[] | { SourceLoginID: string } }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, userEmail))
    .then((r) => r[0])

  if (!user) {
    console.error(`No user found with email: ${userEmail}`)
    process.exit(1)
  }

  const cats = await db.select().from(categories)
  const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]))
  const fallback = catBySlug['home']

  // ─── Phase 1: Dedup ──────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════')
  console.log(' Phase 1: Deduplicate triplicates')
  console.log('═══════════════════════════════════════')

  // Get all login entries, sorted by createdAt ascending (keep oldest)
  const allEntries = await db
    .select({ id: entries.id, title: entries.title, username: entries.username, password: entries.password, url: entries.url, createdAt: entries.createdAt })
    .from(entries)
    .where(eq(entries.type, 'login'))

  // Group by title+username+password+url
  const seen = new Map<string, string>() // key → oldest id
  const toDelete: string[] = []

  // Sort by createdAt ascending to find oldest
  allEntries.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return ta - tb
  })

  for (const e of allEntries) {
    const key = `${e.title}||${e.username ?? ''}||${e.password ?? ''}||${e.url ?? ''}`
    if (seen.has(key)) {
      toDelete.push(e.id)
    } else {
      seen.set(key, e.id)
    }
  }

  console.log(`  Total login entries in DB  : ${allEntries.length}`)
  console.log(`  Exact duplicates to delete : ${toDelete.length}`)
  console.log(`  Will remain after dedup    : ${allEntries.length - toDelete.length}`)

  if (!dryRun && toDelete.length > 0) {
    const BATCH = 100
    let deleted = 0
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH)
      for (const id of batch) {
        await db.delete(entries).where(eq(entries.id, id))
      }
      deleted += batch.length
      process.stdout.write(`  Deleted ${deleted}/${toDelete.length}\r`)
    }
    console.log(`\n  Done. Deleted ${toDelete.length} duplicates.`)
  } else if (dryRun) {
    console.log('  [DRY RUN] No deletions performed.')
  }

  // ─── Phase 2: Secondary logins ───────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════')
  console.log(' Phase 2: Import secondary credentials')
  console.log('═══════════════════════════════════════')

  // Re-fetch current DB state (after dedup) to check what already exists
  const existingEntries = await db
    .select({ title: entries.title, username: entries.username, password: entries.password })
    .from(entries)
    .where(eq(entries.type, 'login'))

  const existingSet = new Set(
    existingEntries.map((e) => `${e.title}||${e.username ?? ''}||${e.password ?? ''}`)
  )

  const toInsert: {
    categoryId: string
    type: 'login'
    title: string
    username: string | null
    password: string | null
    url: string | null
    tags: string[] | null
    isFavorite: boolean
    isPrivate: boolean
    createdBy: string
    updatedBy: string
  }[] = []

  let accountsWithMultiple = 0
  let alreadyExists = 0

  for (const account of toArray<StickyAccount>(data.Accounts?.Account)) {
    const groupId = String(account.ParentID)
    if (isBookmarkGroup(groupId)) continue

    const url = account.Link || ''
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ftp://')) continue

    const loginLinks = toArray<{ SourceLoginID: string }>(
      account.LoginLinks?.Login as { SourceLoginID: string }[] | undefined,
    )

    // Skip if only 1 credential (already imported)
    if (loginLinks.length <= 1) continue

    accountsWithMultiple++
    const chain = getGroupChain(groupId)
    const { slug, isFavorite } = mapGroupToSlug(chain)
    const cat = catBySlug[slug] || fallback

    // Start from index 1 — skip the first (already imported)
    for (let i = 1; i < loginLinks.length; i++) {
      const creds = loginMap.get(String(loginLinks[i].SourceLoginID))
      const username = creds?.username || null
      const password = creds?.password || null

      // Skip truly empty credentials
      if (!username && !password) continue

      const key = `${account.Name}||${username ?? ''}||${password ?? ''}`
      if (existingSet.has(key)) {
        alreadyExists++
        continue
      }

      // Mark as seen so we don't double-insert within this run
      existingSet.add(key)

      toInsert.push({
        categoryId: cat.id,
        type: 'login',
        title: account.Name || 'Unnamed',
        username,
        password,
        url: url || null,
        tags: chain.length > 0 ? chain : null,
        isFavorite,
        isPrivate: false,
        createdBy: user.id,
        updatedBy: user.id,
      })
    }
  }

  console.log(`  Accounts with multiple credentials : ${accountsWithMultiple}`)
  console.log(`  Already in DB (skip)               : ${alreadyExists}`)
  console.log(`  New secondary entries to insert    : ${toInsert.length}`)

  if (toInsert.length > 0 && !dryRun) {
    const BATCH = 100
    let inserted = 0
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await db.insert(entries).values(toInsert.slice(i, i + BATCH))
      inserted += Math.min(BATCH, toInsert.length - i)
      process.stdout.write(`  Inserted ${inserted}/${toInsert.length}\r`)
    }
    console.log(`\n  Done. Inserted ${toInsert.length} secondary credential entries.`)
  } else if (dryRun) {
    console.log('  [DRY RUN] No insertions performed.')
    if (toInsert.length > 0) {
      console.log('\n  Sample of what would be inserted:')
      toInsert.slice(0, 8).forEach((e) => {
        console.log(`    "${e.title}" — user: "${e.username}" pass: "${e.password}"`)
      })
    }
  }

  const finalCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(entries)
    .then((r) => Number(r[0].count))

  console.log(`\n  Total entries in DB now: ${finalCount}`)
  console.log('\nAll done!')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
