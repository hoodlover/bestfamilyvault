// Off-Vercel snapshot of the entire vault — DB tables as JSON + blob
// inventory. Insurance against Vercel/Neon account loss, accidental drops,
// or a key rotation gone wrong. Encrypted columns stay encrypted in the
// dump (decryption requires ENCRYPTION_KEY anyway).
//
//   npx tsx --env-file=.env.local scripts/backup-vault.ts
//   npx tsx --env-file=.env.local scripts/backup-vault.ts --with-blobs
//
// Output lands in ./backups/{timestamp}/  (gitignored).
//
// Without --with-blobs:
//   - Every DB table dumped as JSON (one file per table)
//   - Blob inventory (filenames + URLs + sizes + content types)
//   - Manifest summarizing everything
//
// With --with-blobs:
//   - Same as above, plus every blob downloaded into ./blobs/
//   - Slow and big: 7+ GB and ~10 minutes for Lance's vault
//
// Run weekly. Stash the resulting folder on an external drive or a
// non-Vercel cloud (Backblaze, Dropbox). The whole point is that NOTHING
// in this archive depends on Vercel or Neon being alive.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { list } from '@vercel/blob'
import { db } from '../src/lib/db'
import * as schema from '../src/lib/db/schema'

// All tables that hold real vault content. Order doesn't matter for backup
// (it's just JSON dumps), but keeping them grouped makes the output readable.
const TABLES = [
  ['users', schema.users],
  ['accounts', schema.accounts],
  ['sessions', schema.sessions],
  ['verificationTokens', schema.verificationTokens],
  ['invites', schema.invites],
  ['upgradeRequests', schema.upgradeRequests],
  ['messages', schema.messages],
  ['categories', schema.categories],
  ['subcategories', schema.subcategories],
  ['entries', schema.entries],
  ['notes', schema.notes],
  ['letters', schema.letters],
  ['letterRelease', schema.letterRelease],
  ['files', schema.files],
  ['timeCapsules', schema.timeCapsules],
  ['passwordResetTokens', schema.passwordResetTokens],
] as const

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function main() {
  const withBlobs = process.argv.includes('--with-blobs')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const root = path.join(process.cwd(), 'backups', stamp)
  fs.mkdirSync(path.join(root, 'db'), { recursive: true })
  fs.mkdirSync(path.join(root, 'blobs'), { recursive: true })

  console.log(`Backup → ${root}`)
  console.log()

  // ── DB dump ────────────────────────────────────────────────────────────────
  console.log('DB tables:')
  const tableSummary: Record<string, { rows: number; bytes: number }> = {}
  for (const [name, table] of TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await db.select().from(table as any)
      const json = JSON.stringify(rows, null, 2)
      const file = path.join(root, 'db', `${name}.json`)
      fs.writeFileSync(file, json, 'utf8')
      tableSummary[name] = { rows: rows.length, bytes: Buffer.byteLength(json, 'utf8') }
      console.log(`  ✓ ${name.padEnd(22)} ${String(rows.length).padStart(6)} rows  ${formatBytes(Buffer.byteLength(json, 'utf8'))}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ ${name}: ${msg}`)
      tableSummary[name] = { rows: -1, bytes: 0 }
    }
  }

  // ── Blob inventory ─────────────────────────────────────────────────────────
  console.log()
  console.log('Blob inventory:')
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('  (skipped — BLOB_READ_WRITE_TOKEN not set)')
  } else {
    type BlobEntry = { pathname: string; url: string; size: number; uploadedAt: string; contentType?: string }
    const blobs: BlobEntry[] = []
    let cursor: string | undefined
    do {
      const res = await list({ cursor, limit: 1000 })
      for (const b of res.blobs) {
        blobs.push({
          pathname: b.pathname,
          url: b.url,
          size: b.size,
          uploadedAt: b.uploadedAt.toISOString(),
          contentType: 'contentType' in b ? (b as { contentType?: string }).contentType : undefined,
        })
      }
      cursor = res.cursor
    } while (cursor)

    fs.writeFileSync(path.join(root, 'blobs', 'manifest.json'), JSON.stringify(blobs, null, 2), 'utf8')
    const totalBytes = blobs.reduce((a, b) => a + b.size, 0)
    console.log(`  ${blobs.length} blobs · ${formatBytes(totalBytes)}`)

    if (withBlobs) {
      // Download each blob to ./blobs/files/<pathname>. The URL on a
      // private blob requires the auth header for download.
      console.log()
      console.log(`Downloading ${blobs.length} blobs (this is the slow part)…`)
      let i = 0
      const filesDir = path.join(root, 'blobs', 'files')
      for (const b of blobs) {
        i++
        const target = path.join(filesDir, b.pathname)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        try {
          const res = await fetch(b.url, {
            headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
          })
          if (!res.ok) {
            console.error(`  [${i}/${blobs.length}] ${b.pathname} → HTTP ${res.status}`)
            continue
          }
          const buf = Buffer.from(await res.arrayBuffer())
          fs.writeFileSync(target, buf)
          if (i % 25 === 0 || i === blobs.length) {
            console.log(`  [${i}/${blobs.length}] ${b.pathname}`)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`  [${i}/${blobs.length}] ${b.pathname} → ${msg}`)
        }
      }
    } else {
      console.log('  (--with-blobs not passed — only the manifest was saved)')
    }
  }

  // ── Manifest ───────────────────────────────────────────────────────────────
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    withBlobs,
    tables: tableSummary,
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log()
  console.log('Done.')
  console.log()
  console.log('Next: copy the backup folder somewhere off-Vercel.')
  console.log(`  Robocopy: robocopy "${root}" "<destination>" /E`)
  console.log(`  rclone:   rclone copy "${root}" remote:cobbvault-backups/${stamp}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
