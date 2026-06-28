'use client'

// Full-screen scan/crop editor. Receives an image File, lets the user drag
// four corner handles over the document, then perspective-corrects and
// brightens the result. Hands the cleaned-up JPEG back via onAccept so the
// caller can carry on with whatever upload flow it already had.
//
// The viewport image is rendered into a display canvas at a downscaled
// size so dragging stays smooth on phones; the actual warp runs at full
// source resolution when the user hits Save.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw, Wand2, X } from 'lucide-react'
import {
  enhanceDocument,
  suggestOutputSize,
  warpQuadrilateral,
  type Point,
} from '@/lib/perspective-warp'

interface Props {
  file: File
  onAccept: (file: File) => void
  onCancel: () => void
  /** JPEG quality 0–1. Default 0.9. */
  quality?: number
  /**
   * Initial state of the "Clean up" toggle. Default true (matches the
   * doc/ID/upload flows). The receipt flow passes false so the histogram
   * stretch doesn't blow out paper-white highlights into a glare.
   */
  defaultEnhance?: boolean
}

const HANDLE_RADIUS = 16
const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'] as const

export function DocScannerEditor({ file, onAccept, onCancel, quality = 0.9, defaultEnhance = true }: Props) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [bitmapSize, setBitmapSize] = useState<{ w: number; h: number } | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [enhance, setEnhance] = useState(defaultEnhance)
  const [processing, setProcessing] = useState(false)
  // Corners are in *source-image* coordinates (not display coordinates) so
  // the warp can run at the full resolution of the source.
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [surfaceSize, setSurfaceSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  // Decode the file into an ImageBitmap and seed the corners just inside
  // the image edges — gives the user something close to a rectangular
  // crop right away, with a small inset so the handles are visible.
  useEffect(() => {
    let cancelled = false
    setDecodeError(null)
    void (async () => {
      try {
        const bmp = await createImageBitmap(file)
        if (cancelled) {
          bmp.close()
          return
        }
        setBitmap(bmp)
        setBitmapSize({ w: bmp.width, h: bmp.height })
        const inset = Math.round(Math.min(bmp.width, bmp.height) * 0.05)
        setCorners([
          { x: inset, y: inset },
          { x: bmp.width - inset, y: inset },
          { x: bmp.width - inset, y: bmp.height - inset },
          { x: inset, y: bmp.height - inset },
        ])
      } catch (err) {
        if (cancelled) return
        setDecodeError(err instanceof Error ? err.message : 'Could not decode this image.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    return () => {
      bitmap?.close()
    }
  }, [bitmap])

  // Observe the surface size so we can keep the display canvas filling the
  // available area without distorting the aspect ratio.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect
        setSurfaceSize({ w: rect.width, h: rect.height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Compute display rect (the area inside the surface where the image is
  // drawn, letterboxed to preserve aspect ratio).
  const displayRect = useMemo(() => {
    if (!bitmapSize || surfaceSize.w === 0 || surfaceSize.h === 0) return null
    const scale = Math.min(surfaceSize.w / bitmapSize.w, surfaceSize.h / bitmapSize.h)
    const w = bitmapSize.w * scale
    const h = bitmapSize.h * scale
    const x = (surfaceSize.w - w) / 2
    const y = (surfaceSize.h - h) / 2
    return { x, y, w, h, scale }
  }, [bitmapSize, surfaceSize])

  // Render the image to the display canvas whenever the bitmap or display
  // rect changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap || !displayRect) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(displayRect.w * dpr)
    canvas.height = Math.round(displayRect.h * dpr)
    canvas.style.width = `${displayRect.w}px`
    canvas.style.height = `${displayRect.h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.drawImage(bitmap, 0, 0, displayRect.w, displayRect.h)
  }, [bitmap, displayRect])

  // Convert a pointer event in the surface to source-image coordinates.
  const pointerToSource = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = surfaceRef.current
      if (!el || !displayRect) return null
      const rect = el.getBoundingClientRect()
      const lx = clientX - rect.left - displayRect.x
      const ly = clientY - rect.top - displayRect.y
      return {
        x: lx / displayRect.scale,
        y: ly / displayRect.scale,
      }
    },
    [displayRect],
  )

  function startDrag(idx: number, e: React.PointerEvent<SVGCircleElement>) {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(idx)
  }

  function onDragMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragging === null || !corners || !bitmapSize) return
    const p = pointerToSource(e.clientX, e.clientY)
    if (!p) return
    const next = [...corners]
    next[dragging] = {
      x: Math.max(0, Math.min(bitmapSize.w, p.x)),
      y: Math.max(0, Math.min(bitmapSize.h, p.y)),
    }
    setCorners(next)
  }

  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (dragging === null) return
    try {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer was already released */
    }
    setDragging(null)
  }

  function resetCorners() {
    if (!bitmapSize) return
    const inset = Math.round(Math.min(bitmapSize.w, bitmapSize.h) * 0.05)
    setCorners([
      { x: inset, y: inset },
      { x: bitmapSize.w - inset, y: inset },
      { x: bitmapSize.w - inset, y: bitmapSize.h - inset },
      { x: inset, y: bitmapSize.h - inset },
    ])
  }

  async function applyAndAccept() {
    if (!bitmap || !corners) return
    setProcessing(true)
    try {
      // Yield once so the spinner can paint before the heavy pixel loop.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const { width, height } = suggestOutputSize(corners)
      // Cap at 2400 long-edge to match the rest of the upload pipeline.
      const maxLong = 2400
      const longest = Math.max(width, height)
      const scale = longest > maxLong ? maxLong / longest : 1
      const outW = Math.max(64, Math.round(width * scale))
      const outH = Math.max(64, Math.round(height * scale))
      // suggestOutputSize works in source-image coords; for the warp we
      // need to scale the *target* rectangle, but the source corners stay
      // the same — the warp samples from the source.
      const warped = warpQuadrilateral(bitmap, corners, outW, outH)
      if (enhance) enhanceDocument(warped)
      const blob = await new Promise<Blob | null>((resolve) =>
        warped.toBlob(resolve, 'image/jpeg', quality),
      )
      if (!blob) throw new Error('Could not encode the scanned image.')
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const out = new File([blob], `${baseName}-scan.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      })
      onAccept(out)
    } catch (err) {
      setDecodeError(err instanceof Error ? err.message : 'Scanning failed.')
      setProcessing(false)
    }
  }

  // Build the SVG overlay coordinates (in display pixels).
  const displayCorners = useMemo(() => {
    if (!corners || !displayRect) return null
    return corners.map((p) => ({
      x: p.x * displayRect.scale,
      y: p.y * displayRect.scale,
    }))
  }, [corners, displayRect])

  return (
    <div className="fixed inset-0 z-[210] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-black/85">
        <button
          type="button"
          onClick={onCancel}
          disabled={processing}
          className="p-2 rounded-full text-stone-200 hover:bg-stone-800 disabled:opacity-50 transition"
          aria-label="Cancel scan"
        >
          <X size={22} />
        </button>
        <span className="text-xs uppercase tracking-[0.2em] text-stone-400">Scan &amp; crop</span>
        <button
          type="button"
          onClick={resetCorners}
          disabled={processing || !bitmapSize}
          className="p-2 rounded-full text-stone-200 hover:bg-stone-800 disabled:opacity-50 transition"
          aria-label="Reset corners"
          title="Reset corners"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      {/* Editor surface */}
      <div ref={surfaceRef} className="relative flex-1 overflow-hidden bg-black">
        {decodeError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="text-sm text-red-300">{decodeError}</p>
          </div>
        )}

        {displayRect && (
          <>
            <canvas
              ref={canvasRef}
              className="absolute"
              style={{ left: displayRect.x, top: displayRect.y }}
            />
            {displayCorners && (
              <svg
                className="absolute inset-0 w-full h-full touch-none"
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <polygon
                  points={displayCorners
                    .map((p) => `${p.x + displayRect.x},${p.y + displayRect.y}`)
                    .join(' ')}
                  fill="rgba(16, 185, 129, 0.12)"
                  stroke="rgb(52, 211, 153)"
                  strokeWidth={2}
                />
                {displayCorners.map((p, idx) => (
                  <g key={CORNER_LABELS[idx]}>
                    <circle
                      cx={p.x + displayRect.x}
                      cy={p.y + displayRect.y}
                      r={HANDLE_RADIUS}
                      fill="rgba(16, 185, 129, 0.85)"
                      stroke="white"
                      strokeWidth={2}
                      onPointerDown={(e) => startDrag(idx, e)}
                      style={{ cursor: 'grab' }}
                    />
                  </g>
                ))}
              </svg>
            )}
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-4 bg-black/85">
        <label className="flex items-center gap-2 text-sm text-stone-200">
          <input
            type="checkbox"
            checked={enhance}
            onChange={(e) => setEnhance(e.target.checked)}
            disabled={processing}
            className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
          />
          <Wand2 size={14} className="text-emerald-400" />
          Clean up
        </label>
        <button
          type="button"
          onClick={applyAndAccept}
          disabled={processing || !bitmap || !corners}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
        >
          {processing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Scanning…
            </>
          ) : (
            <>
              <Check size={14} />
              Use scan
            </>
          )}
        </button>
      </div>
    </div>
  )
}
