// Server-only helper that lists every icon file under
// public/icons/cobb/icons/ for the icon picker. Lance keeps the curated
// set there — the parent public/icons/cobb/ folder has the originals + a
// lot of accidental copies, so we ignore it entirely.
//
// Result is cached at module scope so we scan at most once per server
// process. New icons require a deploy / process restart to show up, which
// is fine: icons are checked into git.
//
// Sectioning is by the immediate subfolder name under icons/ (system,
// family, eotw, etc.). Files at the top level fall under "Other".

import 'server-only'
import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import * as path from 'node:path'

export interface CobbIcon {
  /** URL path served from /public, e.g. "/icons/cobb/icons/system/auto.png" */
  path: string
  /** Filename without extension, e.g. "auto" */
  name: string
  /** Lower-case search blob: name with non-alphanum stripped */
  search: string
  /** Group label for the picker UI — the icon's subfolder name. */
  section: string
}

const ICON_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg'])
const ICON_ROOT = path.join(process.cwd(), 'public', 'icons', 'cobb', 'icons')
const URL_PREFIX = '/icons/cobb/icons'
const TOP_LEVEL_SECTION = 'Other'

// Title-case a folder name for display, but keep ALL-CAPS or already-cased
// folder names as-is (so "Recipes" stays "Recipes" and "eotw" becomes "Eotw").
function labelForFolder(name: string): string {
  if (!name) return TOP_LEVEL_SECTION
  return name.charAt(0).toUpperCase() + name.slice(1)
}

let cached: CobbIcon[] | null = null

async function* walk(dir: string): AsyncGenerator<{ rel: string }> {
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
      yield { rel: path.relative(ICON_ROOT, full) }
    }
  }
}

export async function getCobbIcons(): Promise<CobbIcon[]> {
  if (cached) return cached

  const icons: CobbIcon[] = []
  for await (const { rel } of walk(ICON_ROOT)) {
    const ext = path.extname(rel).toLowerCase()
    if (!ICON_EXTS.has(ext)) continue
    const name = path.basename(rel, ext)
    const parts = rel.split(path.sep)
    const section = parts.length > 1 ? labelForFolder(parts[0]) : TOP_LEVEL_SECTION
    const urlPath = `${URL_PREFIX}/${parts.join('/')}`
    icons.push({
      path: urlPath,
      name,
      search: name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      section,
    })
  }

  // Sort by section name (alphabetical, with "Other" pinned at the end),
  // then alphabetical within each folder. The picker renders sections in
  // the order the icons appear here.
  icons.sort((a, b) => {
    const aOther = a.section === TOP_LEVEL_SECTION
    const bOther = b.section === TOP_LEVEL_SECTION
    if (aOther !== bOther) return aOther ? 1 : -1
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.name.localeCompare(b.name)
  })
  cached = icons
  return cached
}
