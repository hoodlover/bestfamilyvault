// Browser-side image downsizer. Takes a File picked from the system (which
// can be a 12 MB iPhone photo) and returns a much smaller File ready to
// upload. Non-image files pass through unchanged.
//
// Strategy: decode → resize to max dimension → re-encode as JPEG at quality
// 0.85. We use createImageBitmap when available because it handles more
// formats (including iOS-default HEIC on Safari 17+); fall back to the
// classic Image-element route otherwise.
//
// Animated GIFs are returned untouched — re-encoding to JPEG would drop the
// animation and people generally don't mean to compress them.

const DEFAULT_MAX_DIM = 2400
// Bumped 0.85 → 0.92 because asset photos (cars, jewelry, real estate)
// uploaded via the standard file-upload path were showing JPEG block
// artifacts on smooth surfaces (sky, paint, gemstones). 0.92 matches the
// camera-capture default; size increase per photo is small relative to
// the visual quality gain. Other callers (avatar-upload, locate scanner,
// doc scanner) already pass their own quality override and are unaffected.
const DEFAULT_QUALITY = 0.92
// Skip the work for files that are already small. PNG screenshots from a
// laptop often fall in this range and don't gain much from re-encoding.
const SKIP_BELOW = 600 * 1024

type CompressOptions = {
  maxDim?: number
  quality?: number
  /** Override the SKIP_BELOW threshold per call. */
  skipBelow?: number
}

type DrawableSource = HTMLImageElement | ImageBitmap

async function decodeImage(file: File): Promise<DrawableSource> {
  // createImageBitmap is the more robust path. Available everywhere modern
  // (Chrome, Firefox, Safari 17+) and decodes HEIC/HEIF on Safari natively.
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to Image element
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Browser couldn\'t decode this image format.'))
    }
    img.src = url
  })
}

function dimensionsOf(src: DrawableSource): { width: number; height: number } {
  if (src instanceof HTMLImageElement) {
    return { width: src.naturalWidth, height: src.naturalHeight }
  }
  return { width: src.width, height: src.height }
}

/**
 * Compress an image file in the browser. Returns the compressed File on
 * success, or the original file if compression isn't applicable (non-image,
 * GIF, or already small).
 *
 * If decoding fails outright (bad bytes, unsupported format) the error
 * propagates — caller can show a friendlier message ("This file isn't a
 * supported image. Try saving it as JPEG or PNG first.").
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {}
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.type === 'image/gif') return file // preserve animation
  if (file.type === 'image/svg+xml') return file // SVG re-encoded would become a raster

  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM
  const quality = opts.quality ?? DEFAULT_QUALITY
  const skipBelow = opts.skipBelow ?? SKIP_BELOW

  const src = await decodeImage(file)
  const { width, height } = dimensionsOf(src)

  const scale = Math.min(maxDim / width, maxDim / height, 1)
  const needsResize = scale < 1

  // Already small enough by both dimension and bytes — nothing to gain.
  if (!needsResize && file.size < skipBelow) {
    if (src instanceof ImageBitmap) src.close()
    return file
  }

  const newW = Math.max(1, Math.round(width * scale))
  const newH = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = newW
  canvas.height = newH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    if (src instanceof ImageBitmap) src.close()
    return file
  }

  ctx.drawImage(src, 0, 0, newW, newH)
  if (src instanceof ImageBitmap) src.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  )
  if (!blob) return file

  // Defend against pathological cases where re-encoding produces a *bigger*
  // file (rare, but happens with already-optimised JPEGs).
  if (blob.size >= file.size) return file

  // Rename .heic/.png/etc. to .jpg so the extension matches the new mime.
  const newName = file.name.replace(/\.(png|webp|heic|heif|tiff?|bmp|jpe?g)$/i, '') + '.jpg'

  return new File([blob], newName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}
