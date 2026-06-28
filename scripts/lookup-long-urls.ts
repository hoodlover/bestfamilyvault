// Diagnostic: find entries with long / messy URLs (Gmail deep-links,
// post-login redirects with auth tokens, single-use reset links, etc.)
// and propose a shortened canonical URL for each — just the protocol +
// host, dropping path, query, and hash.
//
// READ-ONLY: prints proposals; doesn't mutate. Hand the output to a
// follow-up migration script (or ack a "go" and I'll write one).
//
// Heuristic for "needs shortening":
//   - URL length > 60 chars, OR
//   - URL contains a query string (?…), OR
//   - URL contains a hash fragment (#…), OR
//   - URL has more than one path segment after the host.
// All four are common shapes for "I pasted whatever was in the address
// bar after I logged in" instead of a clean homepage URL.
//
// Run with: npx tsx --env-file=.env.local scripts/lookup-long-urls.ts

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
    // Origin = protocol + '//' + host (+ port if non-default). Drops
    // everything after — path, query, fragment.
    return u.origin
  } catch {
    return null
  }
}

function isMessy(url: string): boolean {
  if (url.length > 60) return true
  if (url.includes('?')) return true
  if (url.includes('#')) return true
  // Count path segments beyond the host. "https://example.com/foo" → 1
  // segment, "https://example.com/foo/bar" → 2.
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length > 1) return true
  } catch { /* malformed URL — flag it */ return true }
  return false
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  // Skip login + app_login. The browser extension matches credentials by
  // registrable domain, so shortening shouldn't technically break the
  // picker — but per Lance, no upside in risking a regression on
  // autofill. Login URLs stay verbatim regardless of length.
  const rows = (await sql`
    SELECT id, type, title, url
    FROM entry
    WHERE url IS NOT NULL
      AND url <> ''
      AND type NOT IN ('login', 'app_login')
    ORDER BY length(url) DESC
  `) as Row[]

  const messy = rows.filter((r) => isMessy(r.url))
  if (messy.length === 0) {
    console.log('All URLs look clean (≤60 chars, no ?, no #, ≤1 path segment).')
    return
  }

  console.log(`${messy.length} URL${messy.length === 1 ? '' : 's'} flagged as long / messy:\n`)
  for (const r of messy) {
    const proposed = proposeShortUrl(r.url)
    console.log(`  ${r.title}`)
    console.log(`    id        ${r.id}  (${r.type})`)
    console.log(`    current   ${r.url}`)
    console.log(`    proposed  ${proposed ?? '(unparseable URL — manual review)'}`)
    console.log(`    edit      /entries/${r.id}/edit`)
    console.log()
  }

  console.log(`Done. Review the proposed shortenings; if they look right,`)
  console.log(`I'll write a migration that applies them in one shot.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
