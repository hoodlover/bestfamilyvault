// Center-crop every image in an input folder to a 3.5×5 (7:10) aspect ratio.
//
// Pure pixel crop:
//   • EXIF orientation is honored (so phone photos saved sideways come out
//     upright on disk)
//   • No resampling, no resizing — output keeps the source's full pixel
//     resolution, just trims the wider dimension to land on 7:10
//   • JPEG output is re-encoded at quality 100 with chroma subsampling
//     disabled to preserve the original look as closely as a re-encode allows
//
// Usage:
//   npx tsx scripts/crop-photos.ts <input-dir> [output-dir] [--top]
//
// If output-dir is omitted, files land in <input-dir>/cropped/.
//
// --top  When the source is taller than 7:10 and we have to trim
//        top/bottom, anchor the crop to the TOP of the image (so heads
//        in tall portraits don't get clipped). Default is center crop.

import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'

const TARGET_RATIO = 7 / 10 // 3.5 wide / 5 tall = 0.7

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.tif', '.tiff'])

interface CropOpts {
  /** When true and the source is taller than 7:10, anchor the crop to the
   *  top of the image instead of centering vertically. Heads survive. */
  topAnchor: boolean
}

async function cropOne(inputPath: string, outputPath: string, opts: CropOpts) {
  // .rotate() with no args reads EXIF orientation and bakes the rotation
  // into the pixels. Without it, a phone-portrait photo can come back as
  // landscape-on-disk-with-EXIF-orient-6, which would crop the wrong axis.
  const img = sharp(inputPath, { failOn: 'none' }).rotate()

  // metadata() returns the ON-DISK dimensions, not post-rotation. For
  // EXIF orientations 5-8 the rotated image has width/height swapped from
  // what's reported. We need post-rotation dimensions for the extract
  // coords below, otherwise sharp rejects the extract as out-of-bounds.
  const rawMeta = await sharp(inputPath, { failOn: 'none' }).metadata()
  if (!rawMeta.width || !rawMeta.height) {
    throw new Error(`Could not read dimensions for ${inputPath}`)
  }
  const orient = rawMeta.orientation ?? 1
  const swap = orient >= 5 && orient <= 8
  const width = swap ? rawMeta.height : rawMeta.width
  const height = swap ? rawMeta.width : rawMeta.height

  const sourceRatio = width / height
  let cropW: number
  let cropH: number
  if (sourceRatio > TARGET_RATIO) {
    // Source is wider than 7:10 → trim the sides, keep full height.
    cropH = height
    cropW = Math.round(height * TARGET_RATIO)
  } else {
    // Source is narrower than 7:10 (or already at it) → trim top/bottom.
    cropW = width
    cropH = Math.round(width / TARGET_RATIO)
  }
  // Defensive: never request a larger crop than the source.
  cropW = Math.min(cropW, width)
  cropH = Math.min(cropH, height)
  // Horizontal axis is always centered (no use case for left/right anchor).
  const left = Math.floor((width - cropW) / 2)
  // Vertical axis: top-anchor when --top is set AND we're trimming height
  // (i.e. the source is taller than 7:10). For wider-than-7:10 sources
  // there's no vertical trim happening so the flag is a no-op.
  const top = opts.topAnchor && cropH < height
    ? 0
    : Math.floor((height - cropH) / 2)

  const ext = path.extname(inputPath).toLowerCase()

  let pipeline = img.extract({ left, top, width: cropW, height: cropH })

  // Match output format to input where possible. JPEG out for HEIC since
  // browsers don't display HEIC consistently.
  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: 9 })
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: 100, lossless: false })
  } else {
    pipeline = pipeline.jpeg({ quality: 100, chromaSubsampling: '4:4:4', mozjpeg: false })
  }

  await pipeline.toFile(outputPath)
  return { width, height, cropW, cropH }
}

async function run() {
  // Crude argv parser: pull out --top first, then treat the remaining
  // positionals as <input-dir> [output-dir].
  const argv = process.argv.slice(2)
  const topAnchor = argv.includes('--top')
  const positional = argv.filter((a) => a !== '--top')
  const inDir = positional[0]
  if (!inDir) {
    console.error('Usage: npx tsx scripts/crop-photos.ts <input-dir> [output-dir] [--top]')
    process.exit(1)
  }
  const outDir = positional[1] ?? path.join(inDir, 'cropped')
  await fs.mkdir(outDir, { recursive: true })

  const entries = await fs.readdir(inDir, { withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => SUPPORTED_EXTS.has(path.extname(n).toLowerCase()))

  if (files.length === 0) {
    console.log(`No supported images found in ${inDir}.`)
    return
  }

  const anchorLabel = topAnchor ? 'top-anchored' : 'center crop'
  console.log(`Cropping ${files.length} file${files.length === 1 ? '' : 's'} to 3.5×5 (${anchorLabel})…`)
  let okCount = 0
  for (const f of files) {
    const inputPath = path.join(inDir, f)
    const ext = path.extname(f).toLowerCase()
    // HEIC → write as JPG so it's displayable everywhere.
    const outName = ext === '.heic'
      ? path.basename(f, ext) + '-3.5x5.jpg'
      : path.basename(f, ext) + '-3.5x5' + ext
    const outputPath = path.join(outDir, outName)
    try {
      const { width, height, cropW, cropH } = await cropOne(inputPath, outputPath, { topAnchor })
      console.log(`  ✓ ${f}  (${width}×${height} → ${cropW}×${cropH})`)
      okCount++
    } catch (err) {
      console.error(`  ✗ ${f}: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`\nDone. ${okCount}/${files.length} cropped to ${outDir}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
