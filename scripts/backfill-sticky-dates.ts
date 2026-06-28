// Backfill entries.createdAt from the Sticky Password XML's CreatedDate
// attribute. Without this, every login imported from Sticky has its
// createdAt set to the import date — so the "On this day" widget can't
// find anything in past years.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-sticky-dates.ts <xml-path> [--apply]
//
// Without --apply, runs in dry-run mode and prints what would change.
// With --apply, writes the updates to the DB.
//
// Match strategy: Sticky Account.Name === vault entry.title (case-
// insensitive exact). Ambiguous matches (multiple entries with the
// same title) are skipped and logged.

import fs from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { eq, ilike, sql, isNotNull } from 'drizzle-orm'
import { db } from '../src/lib/db/index'
import { entries } from '../src/lib/db/schema'

const xmlPath = process.argv[2]
const apply = process.argv.includes('--apply')

if (!xmlPath) {
  console.error('Usage: backfill-sticky-dates.ts <path-to-xml> [--apply]')
  process.exit(1)
}

interface StickyAccount {
  ID: string
  Name?: string
  CreatedDate?: string
}

interface StickyCreditCard {
  ID: string
  Name?: string
  CreatedDate?: string
}

interface StickyIdentity {
  ID: string
  Name?: string
  CreditCards?: { CreditCard: StickyCreditCard[] | StickyCreditCard }
}

function toArray<T>(x: T | T[] | undefined): T[] {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

async function main() {
  const buf = fs.readFileSync(xmlPath)
  const xml = buf.toString('utf16le').replace(/^﻿/, '')

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => ['Group', 'Login', 'Account', 'Identity', 'CreditCard', 'RoleValue'].includes(name),
  })
  const parsed = parser.parse(xml)
  const data = parsed?.root?.Database
  if (!data) {
    console.error('Could not find <root><Database> in XML')
    process.exit(1)
  }

  // Build a list of { name, createdDate, type } from every Account +
  // CreditCard in the XML.
  interface SrcEntry {
    name: string
    createdDate: Date
    type: 'login' | 'credit_card'
  }
  const sources: SrcEntry[] = []

  for (const a of toArray<StickyAccount>(data.Accounts?.Account)) {
    if (!a.Name || !a.CreatedDate) continue
    const d = new Date(a.CreatedDate)
    if (Number.isNaN(d.getTime())) continue
    sources.push({ name: a.Name.trim(), createdDate: d, type: 'login' })
  }
  for (const idn of toArray<StickyIdentity>(data.Identities?.Identity)) {
    for (const cc of toArray<StickyCreditCard>(idn.CreditCards?.CreditCard)) {
      if (!cc.Name || !cc.CreatedDate) continue
      const d = new Date(cc.CreatedDate)
      if (Number.isNaN(d.getTime())) continue
      sources.push({ name: cc.Name.trim(), createdDate: d, type: 'credit_card' })
    }
  }

  console.log(`Parsed ${sources.length} dated source records from XML`)
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`)
  console.log()

  let updated = 0
  let alreadyCorrect = 0
  let ambiguous = 0
  let unmatched = 0

  for (const src of sources) {
    // Case-insensitive exact-match by title.
    const matches = await db
      .select({ id: entries.id, title: entries.title, createdAt: entries.createdAt, type: entries.type })
      .from(entries)
      .where(ilike(entries.title, src.name))

    if (matches.length === 0) {
      unmatched++
      continue
    }
    // Prefer same-type when there are multiple matches.
    let candidates = matches
    if (matches.length > 1) {
      const sameType = matches.filter((m) => m.type === src.type)
      if (sameType.length === 1) candidates = sameType
    }
    if (candidates.length !== 1) {
      ambiguous++
      console.log(`  ? ambiguous: "${src.name}" → ${candidates.length} entries (skipping)`)
      continue
    }
    const m = candidates[0]
    // Skip if already correct (within 1 day — we don't care about
    // microsecond differences from clock skew).
    const delta = Math.abs(m.createdAt.getTime() - src.createdDate.getTime())
    if (delta < 86_400_000) {
      alreadyCorrect++
      continue
    }
    // Only OVERWRITE if the entry's current createdAt is later than the
    // Sticky date. Otherwise we'd be moving a TRULY-newer entry back in
    // time (the Sticky XML is older than the vault, so most matches
    // will be Sticky < entry).
    if (m.createdAt < src.createdDate) {
      console.log(`  ⚠ skip "${src.name}" — entry createdAt (${m.createdAt.toISOString().slice(0, 10)}) is older than Sticky (${src.createdDate.toISOString().slice(0, 10)})`)
      continue
    }

    console.log(`  ${apply ? '✓' : '→'} "${src.name}": ${m.createdAt.toISOString().slice(0, 10)} → ${src.createdDate.toISOString().slice(0, 10)}`)
    if (apply) {
      await db.update(entries).set({ createdAt: src.createdDate }).where(eq(entries.id, m.id))
    }
    updated++
  }

  console.log()
  console.log(`Summary:`)
  console.log(`  ${apply ? 'Updated' : 'Would update'}:   ${updated}`)
  console.log(`  Already correct:    ${alreadyCorrect}`)
  console.log(`  Ambiguous (skipped): ${ambiguous}`)
  console.log(`  Unmatched in vault:  ${unmatched}`)

  if (!apply && updated > 0) {
    console.log(`\nRe-run with --apply to commit the ${updated} updates.`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
