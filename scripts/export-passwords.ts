// Generates a printable "emergency backup" of every credential-bearing entry
// in the vault. Output is a self-contained HTML file you open in a browser
// and Print → Save as PDF. Print it, put it in a fireproof safe.
//
//   npx tsx --env-file=.env.local scripts/export-passwords.ts
//   npx tsx --env-file=.env.local scripts/export-passwords.ts --with-notes
//
// The HTML lives under `exports/` (gitignored). Delete it once printed.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { asc } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { entries, notes, categories, subcategories } from '../src/lib/db/schema'
import { decryptEntries, decryptNotes } from '../src/lib/crypto'

type Entry = Awaited<ReturnType<typeof db.select>> extends never ? never : never

async function main() {
  const includeNotes = process.argv.includes('--with-notes')

  if (!process.env.ENCRYPTION_KEY) {
    console.error('Missing ENCRYPTION_KEY — needed to decrypt sensitive fields.')
    process.exit(1)
  }

  const outDir = path.join(process.cwd(), 'exports')
  fs.mkdirSync(outDir, { recursive: true })

  console.log('Fetching data from prod DB...')
  const [allCats, allSubs, allEntriesRaw, allNotesRaw] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    db.select().from(subcategories).orderBy(asc(subcategories.sortOrder)),
    db.select().from(entries),
    includeNotes ? db.select().from(notes) : Promise.resolve([]),
  ])

  const allEntries = decryptEntries(allEntriesRaw)
  const allNotes = includeNotes ? decryptNotes(allNotesRaw) : []

  console.log(`  ${allEntries.length} entries · ${allNotes.length} notes · ${allCats.length} categories`)

  const catById = new Map(allCats.map((c) => [c.id, c]))
  const subById = new Map(allSubs.map((s) => [s.id, s]))

  // Group entries by category id
  const entriesByCat = new Map<string, typeof allEntries>()
  for (const e of allEntries) {
    if (!e.categoryId) continue
    const list = entriesByCat.get(e.categoryId) ?? []
    list.push(e)
    entriesByCat.set(e.categoryId, list)
  }

  const notesByCat = new Map<string, typeof allNotes>()
  for (const n of allNotes) {
    if (!n.categoryId) continue
    const list = notesByCat.get(n.categoryId) ?? []
    list.push(n)
    notesByCat.set(n.categoryId, list)
  }

  const stamp = new Date()
  const stampForFile = stamp.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const stampHuman = stamp.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  // ─── Build HTML ─────────────────────────────────────────────────────────────

  const css = `
@page { size: letter; margin: 0.5in; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
       color: #000; background: #fff; margin: 0; padding: 1.5rem; line-height: 1.4; }
header { border-bottom: 3px double #000; padding-bottom: 1rem; margin-bottom: 1.5rem; }
header h1 { margin: 0 0 0.25rem 0; font-size: 24pt; }
header .meta { font-size: 10pt; color: #555; }
header .confidential {
  display: inline-block; margin-top: 0.5rem; padding: 4px 10px;
  background: #b91c1c; color: #fff; font-weight: bold; font-size: 9pt;
  letter-spacing: 0.1em; text-transform: uppercase;
}
section.cat { margin-bottom: 1rem; }
section.cat > h2 {
  border-bottom: 1px solid #000; padding-bottom: 4px;
  font-size: 16pt; margin: 1rem 0 0.5rem 0;
  page-break-after: avoid;
}
.entry, .note {
  break-inside: avoid; page-break-inside: avoid;
  border: 1px solid #ddd; border-radius: 6px;
  padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; background: #fafafa;
}
.entry h3, .note h3 {
  margin: 0 0 0.25rem 0; font-size: 11pt;
  display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;
}
.entry .badge, .note .badge {
  font-size: 8pt; color: #555; font-weight: normal;
  background: #fff; border: 1px solid #ccc; padding: 1px 6px; border-radius: 4px;
}
.fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 0.75rem; font-size: 9pt; }
.fields dt { color: #555; font-weight: 600; white-space: nowrap; }
.fields dd { margin: 0; word-break: break-all; }
.fields dd.mono { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
.empty { color: #999; font-style: italic; font-size: 9pt; }
.notes-block { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #ccc;
                font-size: 9pt; white-space: pre-wrap; }
@media print {
  body { padding: 0; }
  .entry, .note { background: #fff !important; }
}
`

  function esc(s: string | null | undefined): string {
    if (s == null) return ''
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]!))
  }

  function row(label: string, value: string | null | undefined, mono = false): string {
    const v = value?.toString().trim()
    if (!v) return ''
    return `<dt>${esc(label)}</dt><dd${mono ? ' class="mono"' : ''}>${esc(v)}</dd>`
  }

  function renderEntry(e: typeof allEntries[number]): string {
    const sub = e.subcategoryId ? subById.get(e.subcategoryId) : null
    const flags = [
      e.isPrivate ? '<span class="badge">private</span>' : '',
      e.isPersonal ? '<span class="badge">personal</span>' : '',
      sub ? `<span class="badge">${esc(sub.name)}</span>` : '',
    ].filter(Boolean).join(' ')

    let fields = ''
    switch (e.type) {
      case 'login':
        fields = [
          row('URL', e.url),
          row('Username', e.username),
          row('Password', e.password, true),
        ].join('')
        break
      case 'bank_account':
        fields = [
          row('Bank', e.bankName),
          row('Type', e.accountType),
          row('Account #', e.accountNumber, true),
          row('Routing #', e.routingNumber, true),
        ].join('')
        break
      case 'credit_card':
        fields = [
          row('Cardholder', e.cardholderName),
          row('Network', e.cardNetwork),
          row('Card #', e.cardNumber, true),
          row('Expiry', e.expiryDate),
          row('CVV', e.cvv, true),
        ].join('')
        break
      case 'identity':
        fields = [
          row('Name', [e.firstName, e.lastName].filter(Boolean).join(' ')),
          row('DOB', e.dateOfBirth),
          row('SSN', e.ssn, true),
          row('Passport', e.passport, true),
          row("Driver's Lic.", e.driversLicense, true),
        ].join('')
        break
      default:
        fields = ''
    }

    const noteBlock = e.noteContent?.trim()
      ? `<div class="notes-block">${esc(e.noteContent)}</div>`
      : ''

    return `<div class="entry">
      <h3><span>${esc(e.title)}</span><span>${flags}<span class="badge">${e.type.replace('_', ' ')}</span></span></h3>
      ${fields ? `<dl class="fields">${fields}</dl>` : ''}
      ${noteBlock}
    </div>`
  }

  function renderNote(n: typeof allNotes[number]): string {
    const sub = n.subcategoryId ? subById.get(n.subcategoryId) : null
    const flags = [
      n.isPrivate ? '<span class="badge">private</span>' : '',
      n.isPersonal ? '<span class="badge">personal</span>' : '',
      sub ? `<span class="badge">${esc(sub.name)}</span>` : '',
    ].filter(Boolean).join(' ')
    const body = n.content?.trim()
      ? `<div class="notes-block">${esc(n.content)}</div>`
      : '<div class="empty">(no content)</div>'
    return `<div class="note">
      <h3><span>${esc(n.title)}</span><span>${flags}<span class="badge">note</span></span></h3>
      ${body}
    </div>`
  }

  let body = ''
  for (const cat of allCats) {
    const ents = entriesByCat.get(cat.id) ?? []
    const ns = notesByCat.get(cat.id) ?? []
    if (ents.length === 0 && ns.length === 0) continue

    ents.sort((a, b) => a.title.localeCompare(b.title))
    ns.sort((a, b) => a.title.localeCompare(b.title))

    body += `<section class="cat"><h2>${esc(cat.name)}</h2>`
    body += ents.map(renderEntry).join('')
    if (ns.length > 0) body += ns.map(renderNote).join('')
    body += '</section>'
  }

  if (!body) body = '<p class="empty">No entries to export.</p>'

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>The Cobb Family Vault — Emergency Print (${stampForFile})</title>
<style>${css}</style>
</head>
<body>
<header>
  <h1>The Cobb Family Vault</h1>
  <div class="meta">Emergency Print · Generated ${esc(stampHuman)}</div>
  <div class="meta">${allEntries.length} entries${includeNotes ? ` · ${allNotes.length} notes` : ''}</div>
  <div class="confidential">Confidential — Store in a Safe</div>
</header>
${body}
</body>
</html>`

  const filename = `cobb-vault-${stampForFile}.html`
  const fullPath = path.join(outDir, filename)
  fs.writeFileSync(fullPath, html, 'utf8')

  console.log()
  console.log(`Wrote: ${fullPath}`)
  console.log()
  console.log('Next steps:')
  console.log('  1. Open the file in Chrome/Edge.')
  console.log('  2. File menu → Print → "Save as PDF" (or print to paper).')
  console.log('  3. Delete the .html file after printing — it contains plaintext credentials.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
