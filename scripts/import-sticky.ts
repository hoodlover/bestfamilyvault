/**
 * Import Sticky Password XML export into BestFamilyVault.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/import-sticky.ts <path-to-xml> <userEmail>
 *
 * Example:
 *   npx tsx --env-file=.env.local scripts/import-sticky.ts "C:/users/lance/documents/stickypass.xml" lance@bestfamilyvault.com
 *
 * What it imports:
 *   - Accounts (web logins) → login entries, skipping bookmarks & android:// URIs
 *   - CreditCards (from Identities) → credit_card entries
 */

import fs from 'fs'
import { XMLParser } from 'fast-xml-parser'
import { db } from '../src/lib/db/index'
import { entries, categories, users } from '../src/lib/db/schema'
import { eq } from 'drizzle-orm'

// ─── CLI args ─────────────────────────────────────────────────────────────────

const xmlPath = process.argv[2]
const userEmail = process.argv[3]

if (!xmlPath || !userEmail) {
  console.error('Usage: import-sticky.ts <path-to-xml> <userEmail>')
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

// ─── Build group map ──────────────────────────────────────────────────────────

interface StickyGroup {
  ID: string
  Name: string
  ParentID: string
}

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

interface StickyLogin {
  ID: string
  Name: string
  RealLogin?: string
  Password?: string
}

const loginMap = new Map<string, { username: string; password: string }>()
for (const l of toArray<StickyLogin>(data.Logins?.Login)) {
  loginMap.set(String(l.ID), {
    username: l.RealLogin || l.Name || '',
    password: l.Password || '',
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StickyAccount {
  ID: string
  Name: string
  ParentID: string
  Link?: string
  LoginLinks?: { Login: { SourceLoginID: string }[] | { SourceLoginID: string } }
}

interface StickyRoleValue {
  RoleType: string
  Name?: string
}

interface StickyCreditCard {
  ID: string
  Name: string
  ParentID: string
  RoleValues?: { RoleValue: StickyRoleValue[] }
}

interface StickyIdentity {
  ID: string
  Name: string
  CreditCards?: { CreditCard: StickyCreditCard[] | StickyCreditCard }
}

interface EntryInsert {
  categoryId: string
  type: 'login' | 'credit_card'
  title: string
  username?: string | null
  password?: string | null
  url?: string | null
  cardNetwork?: string | null
  cardNumber?: string | null
  cvv?: string | null
  expiryDate?: string | null
  cardholderName?: string | null
  bankName?: string | null
  tags?: string[] | null
  isFavorite: boolean
  isPrivate: boolean
  createdBy: string
  updatedBy: string
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Fetch user
  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, userEmail))
    .then((r) => r[0])

  if (!user) {
    console.error(`No user found with email: ${userEmail}`)
    process.exit(1)
  }

  // Fetch categories
  const cats = await db.select().from(categories)
  const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c]))
  const fallback = catBySlug['home']

  if (!fallback) {
    console.error('No "home" category found — run db:seed first')
    process.exit(1)
  }

  const financeCategory = catBySlug['finance'] || fallback
  const toInsert: EntryInsert[] = []
  let skippedBookmarks = 0
  let skippedBadUrl = 0

  // ── Accounts → login entries ──────────────────────────────────────────────

  for (const account of toArray<StickyAccount>(data.Accounts?.Account)) {
    const groupId = String(account.ParentID)

    if (isBookmarkGroup(groupId)) { skippedBookmarks++; continue }

    const url = account.Link || ''
    if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ftp://')) {
      skippedBadUrl++
      continue
    }

    const loginLinks = toArray<{ SourceLoginID: string }>(
      account.LoginLinks?.Login as { SourceLoginID: string }[] | undefined,
    )
    const creds = loginLinks.length > 0 ? loginMap.get(String(loginLinks[0].SourceLoginID)) : null

    const chain = getGroupChain(groupId)
    const { slug, isFavorite } = mapGroupToSlug(chain)
    const cat = catBySlug[slug] || fallback

    toInsert.push({
      categoryId: cat.id,
      type: 'login',
      title: account.Name || 'Unnamed',
      username: creds?.username || null,
      password: creds?.password || null,
      url: url || null,
      tags: chain.length > 0 ? chain : null,
      isFavorite,
      isPrivate: false,
      createdBy: user.id,
      updatedBy: user.id,
    })
  }

  // ── CreditCards from Identities ───────────────────────────────────────────

  const CC_ROLE = { NETWORK: '37', NUMBER: '38', CVV: '39', EXPIRY: '40', CARDHOLDER: '42', BANK: '43' }

  for (const identity of toArray<StickyIdentity>(data.Identities?.Identity)) {
    const cards = toArray<StickyCreditCard>(
      identity.CreditCards?.CreditCard as StickyCreditCard[] | undefined,
    )

    for (const card of cards) {
      const roles = toArray<StickyRoleValue>(card.RoleValues?.RoleValue)
      const roleByType = Object.fromEntries(
        roles.filter((r) => r.Name).map((r) => [r.RoleType, r.Name!]),
      )

      const rawExpiry = roleByType[CC_ROLE.EXPIRY] || ''
      const expiry =
        rawExpiry.length === 6 ? `${rawExpiry.slice(0, 2)}/${rawExpiry.slice(2)}` : rawExpiry || null

      toInsert.push({
        categoryId: financeCategory.id,
        type: 'credit_card',
        title: card.Name || 'Credit Card',
        cardNetwork: roleByType[CC_ROLE.NETWORK] || null,
        cardNumber: roleByType[CC_ROLE.NUMBER] || null,
        cvv: roleByType[CC_ROLE.CVV] || null,
        expiryDate: expiry,
        cardholderName: roleByType[CC_ROLE.CARDHOLDER] || null,
        bankName: roleByType[CC_ROLE.BANK] || null,
        tags: [identity.Name],
        isFavorite: false,
        isPrivate: false,
        createdBy: user.id,
        updatedBy: user.id,
      })
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\nImport summary:`)
  console.log(`  Login entries to insert : ${toInsert.filter((e) => e.type === 'login').length}`)
  console.log(`  Credit card entries     : ${toInsert.filter((e) => e.type === 'credit_card').length}`)
  console.log(`  Skipped (bookmarks)     : ${skippedBookmarks}`)
  console.log(`  Skipped (non-http URL)  : ${skippedBadUrl}`)
  console.log()

  // ── Insert in batches of 100 ──────────────────────────────────────────────

  const BATCH = 100
  for (let i = 0; i < toInsert.length; i += BATCH) {
    await db.insert(entries).values(toInsert.slice(i, i + BATCH))
    process.stdout.write(`  Inserted ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length}\r`)
  }

  console.log(`\nDone! ${toInsert.length} entries imported.`)
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
