// Tiny helper for renaming icon files in public/icons/cobb/icons/.
// Most of the picker's icons came in with ChatGPT-generated names
// ("ChatGPT Image May 3, 2026, 03_51_29 PM.png") or screenshot stamps
// that mean nothing to anyone reading the picker. This rename:
//   - moves the file via `git mv` so the history stays clean,
//   - greps the rest of the repo for the old filename and warns if it's
//     referenced anywhere (so you don't break a hardcoded reference,
//     like the document-type icon on the new-entry form),
//   - refuses to overwrite an existing destination.
//
// Usage:
//   List every file with a "messy" auto-generated name (ChatGPT/Screenshot):
//     npx tsx scripts/rename-icons.ts --list
//
//   Rename one icon (extension defaults to .png if omitted on the new name):
//     npx tsx scripts/rename-icons.ts "ChatGPT Image May 3, 2026, 03_51_29 PM.png" gas-meter
//     npx tsx scripts/rename-icons.ts "Screenshot 2026-05-03 172335.png" "doc-folder.png"
//
// You can pass either bare filenames (relative to the icons dir) or
// full paths starting with "public/icons/cobb/icons/" — both work.

import { readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

const ICON_DIR = path.join('public', 'icons', 'cobb', 'icons')
// Pattern that catches ChatGPT, Screenshot, Image, IMG, and pure-numeric
// names (timestamps without a clear label).
const MESSY_PATTERN = /^(ChatGPT|Screenshot|Image|IMG|DSC|\d{4})/i

async function listMessy() {
  const entries = await readdir(ICON_DIR, { withFileTypes: true })
  const messy = entries
    .filter((e) => e.isFile() && MESSY_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort()

  if (messy.length === 0) {
    console.log('No messy-named icons found. Nice.')
    return
  }

  console.log(`Messy icon files in ${ICON_DIR}:\n`)
  for (const f of messy) console.log(`  ${f}`)
  console.log(`\n${messy.length} file${messy.length === 1 ? '' : 's'}.`)
  console.log('\nTo rename one:')
  console.log(`  npx tsx scripts/rename-icons.ts "${messy[0]}" new-name`)
}

async function rename(oldArg: string, newArg: string) {
  // Strip a leading public/... path if the caller gave one, then put both
  // names back inside the icons dir.
  const stripDir = (s: string) => {
    if (s.includes('/') || s.includes('\\')) return path.basename(s)
    return s
  }
  const oldName = stripDir(oldArg)
  // Default to the same extension as the source if the user gave a bare
  // name with no extension.
  let newName = stripDir(newArg)
  if (!path.extname(newName)) newName += path.extname(oldName)

  const oldPath = path.join(ICON_DIR, oldName)
  const newPath = path.join(ICON_DIR, newName)

  try {
    await stat(oldPath)
  } catch {
    console.error(`Source file does not exist: ${oldPath}`)
    process.exit(1)
  }

  try {
    await stat(newPath)
    console.error(`Refusing to overwrite existing file: ${newPath}`)
    process.exit(1)
  } catch {
    // expected — destination should not exist
  }

  // Look for references to the OLD name across src/, scripts/, public/
  // (excluding the icons dir itself). Warn but don't block — a code
  // reference that goes stale is fixable in the same PR.
  const grep = spawnSync(
    'git',
    ['grep', '-l', oldName, '--', 'src/', 'scripts/', 'public/'],
    { encoding: 'utf-8' },
  )
  const refs = (grep.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // Skip the icon file itself (which obviously contains its own name in
    // the path, though git-grep on path won't match that — defensive).
    .filter((p) => p !== oldPath.replace(/\\/g, '/'))

  if (refs.length > 0) {
    console.log(`⚠️  "${oldName}" is referenced in:`)
    for (const r of refs) console.log(`     ${r}`)
    console.log('   Update those references after the rename.\n')
  }

  // Do the rename via git mv so history follows it.
  const mv = spawnSync('git', ['mv', oldPath, newPath], { stdio: 'inherit' })
  if (mv.status !== 0) {
    console.error('git mv failed.')
    process.exit(mv.status ?? 1)
  }

  console.log(`Renamed:  ${oldName}  →  ${newName}`)
  if (refs.length > 0) {
    console.log('\nNow update the references listed above (search-replace works) and commit together:')
    console.log(`  git commit -m "Rename ${oldName} → ${newName}"`)
  } else {
    console.log('\nReady to commit:')
    console.log(`  git commit -m "Rename ${oldName} → ${newName}"`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--list' || args[0] === '-l') {
    await listMessy()
    return
  }
  if (args.length !== 2) {
    console.error('Usage:')
    console.error('  npx tsx scripts/rename-icons.ts --list')
    console.error('  npx tsx scripts/rename-icons.ts "<old.png>" "<new.png>"')
    process.exit(1)
  }
  await rename(args[0], args[1])
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
