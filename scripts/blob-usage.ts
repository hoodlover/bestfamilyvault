// Walks the entire Vercel Blob store and prints a single usage report.
// Read-only — no writes, no deletes. Run with:
//   npx tsx --env-file=.env.local scripts/blob-usage.ts

import { list } from '@vercel/blob'
import { formatBytes } from '../src/lib/format'

const HOBBY_FREE_GB = 1

async function run() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Missing BLOB_READ_WRITE_TOKEN.')
    console.error('Set it in .env.local — same value as on Vercel Production.')
    process.exit(1)
  }

  type Blob = { pathname: string; size: number; uploadedAt: Date }
  const all: Blob[] = []
  let cursor: string | undefined

  try {
    do {
      const res = await list({ cursor, limit: 1000 })
      for (const b of res.blobs) {
        all.push({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt })
      }
      cursor = res.cursor
    } while (cursor)
  } catch (err) {
    // Most common cause is a stale token in .env.local that no longer matches
    // the Vercel Blob store (e.g. the store was rotated or deleted). Surface
    // that without a stack trace so the fix is obvious.
    const msg = err instanceof Error ? err.message : String(err)
    if (/access denied|invalid token|unauthorized/i.test(msg)) {
      console.error('Vercel Blob refused the token in BLOB_READ_WRITE_TOKEN.')
      console.error('Open Vercel → Storage → your Blob store → .env.local tab,')
      console.error('copy the current value, and paste it into .env.local.')
      process.exit(1)
    }
    throw err
  }

  const totalBytes = all.reduce((acc, b) => acc + b.size, 0)
  const totalCount = all.length

  // Group by top-level path segment (e.g. "vault", "avatars"). Anything without
  // a slash falls into "(root)" so strays show up in the report.
  const byPrefix = new Map<string, { count: number; bytes: number }>()
  for (const b of all) {
    const slash = b.pathname.indexOf('/')
    const prefix = slash === -1 ? '(root)' : b.pathname.slice(0, slash)
    const cur = byPrefix.get(prefix) ?? { count: 0, bytes: 0 }
    cur.count += 1
    cur.bytes += b.size
    byPrefix.set(prefix, cur)
  }

  const prefixRows = [...byPrefix.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)

  const top = [...all].sort((a, b) => b.size - a.size).slice(0, 5)

  const HOBBY_BYTES = HOBBY_FREE_GB * 1024 * 1024 * 1024
  const pctOfHobby = ((totalBytes / HOBBY_BYTES) * 100).toFixed(1)

  console.log('Vercel Blob storage report')
  console.log('─────────────────────────────────────')
  console.log(`Total:          ${totalCount} blob${totalCount === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`)
  console.log()
  console.log('By prefix:')
  if (prefixRows.length === 0) {
    console.log('  (empty)')
  } else {
    const widest = Math.max(...prefixRows.map(([p]) => p.length))
    for (const [prefix, stats] of prefixRows) {
      console.log(`  ${(prefix + '/').padEnd(widest + 2)}  ${String(stats.count).padStart(3)} blob${stats.count === 1 ? ' ' : 's'} · ${formatBytes(stats.bytes)}`)
    }
  }
  console.log()
  if (top.length > 0) {
    console.log(`Top ${top.length} largest:`)
    for (const b of top) {
      console.log(`  ${formatBytes(b.size).padStart(9)}  ${b.pathname}`)
    }
    console.log()
  }
  console.log(`Hobby plan free tier: ${HOBBY_FREE_GB} GB · you're using ${pctOfHobby}%.`)
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
