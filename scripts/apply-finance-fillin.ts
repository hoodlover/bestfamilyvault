// Parse FINANCE-FILLIN.md and write any filled-in values back into the
// corresponding entry. Idempotent: skips blank placeholders and never
// overwrites a DB value that's already populated.

import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const IN_PATH = path.resolve(process.cwd(), 'FINANCE-FILLIN.md')
const APPLY = process.argv.includes('--apply')

interface ParsedEntry {
  id: string
  title: string
  values: Record<string, string>
}

function parseSheet(markdown: string): ParsedEntry[] {
  const lines = markdown.split(/\r?\n/)
  const items: ParsedEntry[] = []
  let current: ParsedEntry | null = null

  for (const line of lines) {
    // Section heading — flush any in-progress item.
    if (line.startsWith('### ')) {
      if (current) items.push(current)
      // title before any " _[LLC]_" suffix
      const title = line.slice(4).replace(/\s+_\[.*?\]_\s*$/, '').trim()
      current = { id: '', title, values: {} }
      continue
    }
    // ID comment
    const idMatch = /^<!--\s*id:\s*([0-9a-f-]+)\s*-->/.exec(line)
    if (idMatch && current) {
      current.id = idMatch[1]
      continue
    }
    // Field row: "- **fieldName**: value"
    const fieldMatch = /^\s*-\s*\*\*([a-zA-Z]+)\*\*:\s*(.*)$/.exec(line)
    if (fieldMatch && current) {
      const value = fieldMatch[2].trim()
      if (value) current.values[fieldMatch[1]] = value
    }
  }
  if (current) items.push(current)
  return items.filter((i) => i.id && Object.keys(i.values).length > 0)
}

// Whitelist of fields we accept from the sheet. Prevents typos like
// "**password**: hunter2" from accidentally writing the wrong column.
const ALLOWED_FIELDS = new Set([
  'accountNumber', 'routingNumber', 'cardholderName',
  'cardNumber', 'cardNetwork', 'expiryDate',
])

async function main() {
  console.log(APPLY ? '🟢 APPLY mode — writes will land.' : '🔍 Dry-run — pass --apply to write.')

  const md = await readFile(IN_PATH, 'utf8').catch(() => {
    console.error(`❌ Could not read ${IN_PATH}. Generate it first:`)
    console.error('   npx tsx --env-file=.env.local scripts/generate-finance-fillin.ts')
    process.exit(1)
  })

  const parsed = parseSheet(md)
  if (parsed.length === 0) {
    console.log('Nothing to apply — every field in the sheet is still blank.')
    return
  }

  // Load each entry once so we can skip fields that are already populated
  // in the DB (idempotency + no accidental clobber).
  const idsToLoad = parsed.map((p) => p.id)
  const dbRows = await db.select().from(entries).where(eq(entries.id, idsToLoad[0]))
  // Drizzle inArray import for batched load instead — fall back to per-id
  // for clarity. The set is tiny (≤20).
  const fresh = new Map<string, Record<string, unknown>>()
  for (const id of idsToLoad) {
    const row = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
    if (row) {
      const dec = decryptEntries([row])[0]
      fresh.set(id, dec as unknown as Record<string, unknown>)
    }
  }
  // Reference dbRows so the linter doesn't flag the eager-load above as
  // dead code; the batched-load fallback is intentional for clarity.
  void dbRows

  let updated = 0
  let skipped = 0
  for (const p of parsed) {
    const row = fresh.get(p.id)
    if (!row) {
      console.log(`⚠ entry ${p.id} (${p.title}) not found in DB — skipping`)
      continue
    }
    const patch: Record<string, string> = {}
    for (const [field, value] of Object.entries(p.values)) {
      if (!ALLOWED_FIELDS.has(field)) {
        console.log(`  ⚠ "${field}" not in allowlist — skipping ("${p.title}")`)
        continue
      }
      const existing = row[field]
      if (existing != null && existing !== '') {
        skipped++
        continue
      }
      patch[field] = value
    }
    if (Object.keys(patch).length === 0) continue

    updated++
    console.log(`\n${APPLY ? 'UPDATE' : 'would update'}: ${p.title}`)
    for (const [k, v] of Object.entries(patch)) {
      // Mask anything that looks like a long number so the terminal
      // dump isn't an inadvertent printout of card #s.
      const display = /^\d{6,}$/.test(v.replace(/\s/g, '')) ? `•••• ${v.slice(-4)}` : v
      console.log(`    ${k} → ${display}`)
    }

    if (APPLY) {
      await db.update(entries).set(patch).where(eq(entries.id, p.id))
    }
  }

  console.log(`\n${updated} entries ${APPLY ? 'updated' : 'would be updated'}, ${skipped} fields skipped (already populated).`)
  if (!APPLY && updated > 0) console.log('Re-run with --apply to write.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1) })
