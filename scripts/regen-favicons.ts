// Regenerate the favicon/PWA set from public/icons/cobb/fav2.png.
//
// Usage:
//   npx tsx scripts/regen-favicons.ts

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const script = resolve('scripts/regen-favicons.py')
const result = spawnSync('python', [script], { stdio: 'inherit' })

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
