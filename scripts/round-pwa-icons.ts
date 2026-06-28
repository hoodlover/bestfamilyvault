// One-shot: take the cf-pwa-{192,384,512,1024}.png icons (currently
// flattened on a solid black background) and clip transparent rounded
// corners onto them in-place. Result: the icon registered with
// purpose: 'any' in src/app/manifest.ts no longer shows black corners
// against the user's wallpaper; the maskable variant is unaffected
// because Android applies its own shape mask that lands well inside
// the rounded clip.
//
// Corner radius: 22% of the side length — the iOS "squircle" standard
// rounded-rect ratio. Close enough to Apple's actual continuous-curve
// squircle for the purpose; well-shaped against Android launcher masks.
//
// Run with: npx tsx --env-file=.env.local scripts/round-pwa-icons.ts

import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ICONS_DIR = path.join(process.cwd(), 'public', 'icons', 'cobb')
const TARGETS = [
  'cf-pwa-192.png',
  'cf-pwa-384.png',
  'cf-pwa-512.png',
  'cf-pwa-1024.png',
  // Also round the Apple touch icon used by iOS — same black-corner
  // problem appears in iOS home screen if Safari ever falls back to it.
  'cf-pwa-apple-180.png',
]
const CORNER_RATIO = 0.22

async function roundOne(file: string) {
  const full = path.join(ICONS_DIR, file)
  try {
    await fs.access(full)
  } catch {
    console.log(`  · ${file} (not found, skipping)`)
    return
  }
  const meta = await sharp(full).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) {
    console.log(`  ! ${file} (could not read dimensions)`)
    return
  }
  const radius = Math.round(Math.min(width, height) * CORNER_RATIO)
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/>` +
      `</svg>`,
  )
  // Read into buffer, composite, write back in-place. Writing back to
  // the same path the read came from with .toFile would race; pipe
  // through a buffer first.
  const rounded = await sharp(full)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
  await fs.writeFile(full, rounded)
  console.log(`  ✓ ${file} (${width}×${height}, r=${radius}px)`)
}

async function run() {
  console.log('Clipping rounded transparent corners onto PWA icons:')
  for (const file of TARGETS) {
    await roundOne(file)
  }
  console.log('Done.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
