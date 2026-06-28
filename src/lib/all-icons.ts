// Server-only helper that lists every image file anywhere under
// public/icons/. Used by the /admin/icons browser so the maintainer
// can find any icon by name or folder without grepping the disk.
//
// Result is cached at module scope so we scan at most once per server
// process — new icons require a deploy / restart to appear, which is
// fine because icons are checked into git.
//
// Note: only files under /public are visible — anything you moved to
// /cobbvault-backup is out of scope (it's no longer served to the
// browser). Copy back into /public/icons to make it browsable again.

import 'server-only'
import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import * as path from 'node:path'

export interface VaultIcon {
  /** URL path served from /public, e.g. "/icons/cobb/icons/system/auto.png" */
  path: string
  /** Filename without extension, e.g. "auto" */
  name: string
  /** Folder under public/icons, e.g. "cobb/icons/system" or "" for top-level */
  folder: string
  /** File extension lowercased: ".png", ".webp" etc. */
  ext: string
  /** Byte size — handy for spotting bloated source files. */
  size: number
}

const ICON_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg'])
const ROOT = path.join(process.cwd(), 'public', 'icons')
const URL_PREFIX = '/icons'

let cached: VaultIcon[] | null = null

async function* walk(dir: string): AsyncGenerator<{ full: string; rel: string }> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield { full, rel: path.relative(ROOT, full) }
    }
  }
}

export async function getAllVaultIcons(): Promise<VaultIcon[]> {
  if (cached) return cached
  const out: VaultIcon[] = []
  for await (const { full, rel } of walk(ROOT)) {
    const ext = path.extname(rel).toLowerCase()
    if (!ICON_EXTS.has(ext)) continue
    const name = path.basename(rel, ext)
    const parts = rel.split(path.sep)
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    const urlPath = `${URL_PREFIX}/${parts.join('/')}`
    let size = 0
    try { size = (await stat(full)).size } catch { /* race / perms — ignore */ }
    out.push({ path: urlPath, name, folder, ext, size })
  }
  // Sort: top-level last, then by folder name alphabetical, then by name.
  out.sort((a, b) => {
    const aTop = a.folder === ''
    const bTop = b.folder === ''
    if (aTop !== bTop) return aTop ? 1 : -1
    if (a.folder !== b.folder) return a.folder.localeCompare(b.folder)
    return a.name.localeCompare(b.name)
  })
  cached = out
  return out
}
