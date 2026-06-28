// One-shot: shorten messy entry URLs to their origin (protocol + host).
// Mirrors the diagnostic in scripts/lookup-long-urls.ts — same "messy"
// definition (>60 chars OR query OR hash OR >1 path segment), same
// proposal (origin only).
//
// Behavior:
//   - Re-fetches every entry with a URL, recomputes the proposal, only
//     writes rows where the proposal differs from the current value.
//     So re-runs after a partial apply are safe and a no-op once clean.
//   - Skips any URL that won't parse (manual review handle).
//   - Updates updated_at so the entry list re-sorts naturally and the
//     change is visible in audit-style "recent" views.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-shorten-urls.ts

import { neon } from '@neondatabase/serverless'

interface Row {
  id: string
  type: string
  title: string
  url: string
}

function proposeShortUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.origin
  } catch {
    return null
  }
}

function isMessy(url: string): boolean {
  if (url.length > 60) return true
  if (url.includes('?')) return true
  if (url.includes('#')) return true
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length > 1) return true
  } catch { return true }
  return false
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  // Skip login + app_login. Mirrors the diagnostic — see comment
  // there. We never want to risk a regression on the extension's
  // autofill picker even though the match is by registrable domain.
  const rows = (await sql`
    SELECT id, type, title, url
    FROM entry
    WHERE url IS NOT NULL AND url <> ''
      AND type NOT IN ('login', 'app_login')
  `) as Row[]

  type Update = { id: string; title: string; from: string; to: string }
  const updates: Update[] = []
  const unparseable: Row[] = []

  for (const r of rows) {
    if (!isMessy(r.url)) continue
    const proposed = proposeShortUrl(r.url)
    if (proposed === null) {
      unparseable.push(r)
      continue
    }
    if (proposed === r.url) continue  // already at origin somehow
    updates.push({ id: r.id, title: r.title, from: r.url, to: proposed })
  }

  if (updates.length === 0) {
    console.log('No URLs need shortening — all clean.')
  } else {
    console.log(`Shortening ${updates.length} URL${updates.length === 1 ? '' : 's'}:`)
    for (const u of updates.slice(0, 15)) {
      console.log(`  ${u.title}\n    ${u.from.slice(0, 90)}${u.from.length > 90 ? '…' : ''}\n  → ${u.to}`)
    }
    if (updates.length > 15) console.log(`  … and ${updates.length - 15} more`)
    console.log()
  }

  if (unparseable.length > 0) {
    console.log(`\n⚠ ${unparseable.length} unparseable URL${unparseable.length === 1 ? '' : 's'} skipped — review by hand:`)
    for (const r of unparseable.slice(0, 10)) {
      console.log(`    "${r.title}"  ${r.url}  (/entries/${r.id}/edit)`)
    }
    if (unparseable.length > 10) console.log(`    … and ${unparseable.length - 10} more`)
  }

  // Single batched apply. Each statement is its own tx in neon
  // serverless, so we issue one statement per update — fine at this
  // scale (~210 rows max) and trivially auditable.
  let applied = 0
  for (const u of updates) {
    await sql`
      UPDATE entry
      SET url = ${u.to},
          updated_at = now()
      WHERE id = ${u.id}
    `
    applied += 1
  }
  if (applied > 0) console.log(`\n✓ updated ${applied} row${applied === 1 ? '' : 's'}`)
  console.log('Done.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
