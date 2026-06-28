// Browser-side document warp + clean-up. Takes an image plus four
// quadrilateral corners (top-left, top-right, bottom-right, bottom-left as
// the user dragged them over the source photo) and produces a flat,
// rectangular canvas — the same effect Apple Notes "scan documents" gives
// you after you adjust the corners.
//
// Pure JS: no OpenCV, no WASM. The pixel loop runs on a typical 2400px
// document in well under a second on a mid-range phone.

export type Point = { x: number; y: number }

/**
 * Solve an inverse homography that maps destination pixel (xd, yd) back to a
 * source pixel (xs, ys). We pass the four source-quad corners and the four
 * destination-rectangle corners (always 0,0 → W,H rectangle); the solver
 * produces an 8-element matrix [a b c d e f g h] interpreted as
 *
 *   xs = (a*xd + b*yd + c) / (g*xd + h*yd + 1)
 *   ys = (d*xd + e*yd + f) / (g*xd + h*yd + 1)
 *
 * We solve the 8x8 linear system by partial-pivot Gaussian elimination —
 * fast enough for a one-shot call and avoids pulling in a matrix library.
 */
export function solveInverseHomography(srcQuad: Point[], dstW: number, dstH: number): number[] {
  if (srcQuad.length !== 4) throw new Error('solveInverseHomography needs 4 source corners')

  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ]

  // Build the 8x9 augmented matrix. Each src/dst pair contributes two rows.
  const M: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x: xd, y: yd } = dst[i]
    const { x: xs, y: ys } = srcQuad[i]
    M.push([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd, xs])
    M.push([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd, ys])
  }

  // Gaussian elimination with partial pivoting.
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivotRow = col
    let pivotMag = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(M[r][col])
      if (mag > pivotMag) {
        pivotMag = mag
        pivotRow = r
      }
    }
    if (pivotMag < 1e-10) throw new Error('Degenerate quadrilateral — corners are collinear.')
    if (pivotRow !== col) {
      const tmp = M[col]
      M[col] = M[pivotRow]
      M[pivotRow] = tmp
    }
    const pivot = M[col][col]
    for (let c = col; c <= n; c++) M[col][c] /= pivot
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (factor === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c]
    }
  }

  return M.map((row) => row[n])
}

/**
 * Warp the source image into a rectangle of size outW × outH by reading
 * each destination pixel back from the source via the inverse homography.
 * Bilinear sampling so the result doesn't look pixelated.
 */
export function warpQuadrilateral(
  source: HTMLCanvasElement | HTMLImageElement | ImageBitmap,
  srcQuad: Point[],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const srcCanvas = document.createElement('canvas')
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  srcCanvas.width = srcW
  srcCanvas.height = srcH
  const srcCtx = srcCanvas.getContext('2d')
  if (!srcCtx) throw new Error('Could not allocate a 2D context for the source image.')
  srcCtx.drawImage(source, 0, 0)
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('Could not allocate a 2D context for the destination canvas.')
  const outImg = outCtx.createImageData(outW, outH)
  const outData = outImg.data

  const h = solveInverseHomography(srcQuad, outW, outH)
  const [a, b, c, d, e, f, g, hh] = h

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + hh * y + 1
      const xs = (a * x + b * y + c) / denom
      const ys = (d * x + e * y + f) / denom

      const di = (y * outW + x) * 4
      if (xs < 0 || xs >= srcW - 1 || ys < 0 || ys >= srcH - 1) {
        outData[di] = 0
        outData[di + 1] = 0
        outData[di + 2] = 0
        outData[di + 3] = 255
        continue
      }
      // Bilinear sample.
      const x0 = Math.floor(xs)
      const y0 = Math.floor(ys)
      const dx = xs - x0
      const dy = ys - y0
      const i00 = (y0 * srcW + x0) * 4
      const i10 = i00 + 4
      const i01 = i00 + srcW * 4
      const i11 = i01 + 4
      const w00 = (1 - dx) * (1 - dy)
      const w10 = dx * (1 - dy)
      const w01 = (1 - dx) * dy
      const w11 = dx * dy
      outData[di] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11
      outData[di + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11
      outData[di + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11
      outData[di + 3] = 255
    }
  }

  outCtx.putImageData(outImg, 0, 0)
  return out
}

/**
 * Brighten + boost contrast in-place. Uses a histogram-based black/white
 * point so dim phone photos snap to a clean page-like look without the
 * caller picking magic numbers. Skips the work if the canvas is empty.
 */
export function enhanceDocument(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  if (data.length === 0) return

  // Build a luminance histogram, then pick 2nd / 98th percentile as the
  // black and white points — robust against the few dark fingertip pixels
  // that sometimes creep into a scan.
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    hist[Math.max(0, Math.min(255, Math.round(lum)))]++
  }
  const totalPixels = data.length / 4
  const blackTarget = totalPixels * 0.02
  const whiteTarget = totalPixels * 0.98
  let cum = 0
  let blackPoint = 0
  let whitePoint = 255
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum >= blackTarget) {
      blackPoint = v
      break
    }
  }
  cum = 0
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum >= whiteTarget) {
      whitePoint = v
      break
    }
  }
  if (whitePoint <= blackPoint) {
    blackPoint = 0
    whitePoint = 255
  }

  const range = whitePoint - blackPoint
  // Precompute a lookup table so the per-pixel loop is just three lookups.
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(((v - blackPoint) / range) * 255)
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Given the four user-placed corners (in any order around the quad), figure
 * out the natural output rectangle dimensions: average of opposite edges.
 * Keeps the document's aspect ratio roughly intact.
 */
export function suggestOutputSize(quad: Point[]): { width: number; height: number } {
  const [tl, tr, br, bl] = quad
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y)
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y)
  return {
    width: Math.max(64, Math.round((topW + bottomW) / 2)),
    height: Math.max(64, Math.round((leftH + rightH) / 2)),
  }
}
