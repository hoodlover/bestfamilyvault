// One-shot script: scans every icon in public/icons/cobb/icons/, computes the
// dominant color bucket for each, and writes src/lib/icon-colors.json so the
// picker can group by color.
//
// Run with: node scripts/classify-icon-colors.mjs
//
// Method:
//   1. Resize each icon to 48x48 RGBA with sharp.
//   2. For each non-transparent pixel, convert RGB→HSL.
//   3. Tally a weighted "color bucket" vote per pixel (weight = saturation
//      so neutral pixels don't drown out the actual ink). Saturated colors
//      win over mostly-gray fills.
//   4. Whichever bucket wins becomes the icon's color. If no pixel is
//      colorful enough, fall back to a luminance-based gray/black/white.

import { readdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import sharp from 'sharp'

const ICON_ROOT = path.resolve('public/icons/cobb/icons')
const OUT_FILE = path.resolve('src/lib/icon-colors.json')
const ICON_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif'])

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break
      case g: h = ((b - r) / d + 2); break
      case b: h = ((r - g) / d + 4); break
    }
    h *= 60
  }
  return { h, s, l }
}

function bucketForPixel(h, s, l) {
  // Brown takes priority over orange/red when it's a dark, muted warm.
  if ((h >= 5 && h <= 50) && l < 0.5 && s >= 0.1 && s <= 0.65) return 'brown'

  if (s < 0.18) return null // too gray to count as a color vote

  if (h < 15 || h >= 345) return 'red'
  if (h < 45) return 'orange'
  if (h < 65) return 'yellow'
  if (h < 165) return 'green'
  if (h < 260) return 'blue'
  if (h < 295) return 'purple'
  return 'pink'
}

async function classify(filePath) {
  const { data, info } = await sharp(filePath)
    .resize(48, 48, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const votes = Object.create(null)
  let opaqueCount = 0
  let lumSum = 0

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const a = info.channels === 4 ? data[i + 3] : 255
    if (a < 128) continue
    opaqueCount++
    const { h, s, l } = rgbToHsl(r, g, b)
    lumSum += l
    const bucket = bucketForPixel(h, s, l)
    if (!bucket) continue
    // Weight by saturation so a tiny vivid mark doesn't get out-voted by a
    // sea of near-gray fill, but isn't ignored either.
    votes[bucket] = (votes[bucket] || 0) + s
  }

  if (opaqueCount === 0) return 'gray'

  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  // Need a colored vote total of at least ~5% of opaque pixel mass to count
  // as a chromatic icon — otherwise it's a grayscale icon that happened to
  // have a few stray pixels in a hue range.
  const totalColorVotes = ranked.reduce((a, [, v]) => a + v, 0)
  if (ranked.length === 0 || totalColorVotes < opaqueCount * 0.05) {
    const avgL = lumSum / opaqueCount
    if (avgL > 0.82) return 'white'
    if (avgL < 0.22) return 'black'
    return 'gray'
  }

  return ranked[0][0]
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

async function main() {
  const result = {}
  for await (const file of walk(ICON_ROOT)) {
    const ext = path.extname(file).toLowerCase()
    if (!ICON_EXTS.has(ext)) continue
    const name = path.basename(file, ext)
    try {
      result[name] = await classify(file)
    } catch (err) {
      console.warn(`skip ${path.relative(ICON_ROOT, file)}: ${err.message}`)
      result[name] = 'gray'
    }
  }
  // Sort keys for stable output
  const sorted = Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b))
  )
  await writeFile(OUT_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8')

  const counts = {}
  for (const v of Object.values(sorted)) counts[v] = (counts[v] || 0) + 1
  console.log(`wrote ${Object.keys(sorted).length} entries → ${OUT_FILE}`)
  console.log('counts:', counts)
}

main()
