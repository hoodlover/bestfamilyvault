'use client'

// Photo attach flow for /locate rows.
//
// Step 1: open the OS file picker (camera/gallery on phone, file dialog
//   on desktop). User picks an image.
// Step 2: show that image in a square viewport. Drag to pan, slider to
//   zoom — same feel as the asset thumbnail editor, but operating on a
//   *local* object URL so we can canvas-render the result before upload.
// Step 3: on Save, draw the framed view to a canvas (≤1024px on the long
//   edge, JPEG quality 0.9 — matching the AvatarEditor's encode params)
//   and upload that JPEG as a new file attached to the note. On Skip,
//   upload the original file unchanged.
//
// Mounted as a modal so it overlays the row regardless of layout. Closes
// itself on Save/Skip/Cancel.

import { useEffect, useRef, useState } from 'react'
import { X, Check, ZoomIn, ZoomOut, Forward } from 'lucide-react'
import { uploadFile } from '@/lib/actions/files'

const VIEWPORT = 280
const OUTPUT_MAX = 1024
const JPEG_QUALITY = 0.9

interface Props {
  noteId: string
  onClose: () => void
  onUploaded: () => void
}

export function PhotoCropUploader({ noteId, onClose, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-click the file input the moment we mount so the picker opens
  // right away — saves the user one tap.
  useEffect(() => {
    inputRef.current?.click()
  }, [])

  // Revoke the local object URL when we unmount (or pick a new file).
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl) }, [sourceUrl])

  function pickFile(f: File) {
    if (!f.type.startsWith('image/')) {
      setError('That file isn\'t an image.')
      return
    }
    setError(null)
    setFile(f)
    setSourceUrl(URL.createObjectURL(f))
  }

  async function uploadBlob(blob: Blob, filename: string) {
    setBusy(true)
    setError(null)
    const formData = new FormData()
    formData.append('file', new File([blob], filename, { type: blob.type || 'image/jpeg' }))
    formData.append('noteId', noteId)
    const res = await uploadFile(formData)
    setBusy(false)
    if ('error' in res && res.error) { setError(res.error); return }
    onUploaded()
  }

  async function uploadOriginal() {
    if (!file) return
    await uploadBlob(file, file.name)
  }

  // If the picker is closed (no file picked) the user gets a single
  // "Pick a photo" button. They can always Cancel.
  if (!file || !sourceUrl) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm p-4">
        <div className="rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl p-4 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-200">Attach a photo</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-stone-500 hover:text-stone-200"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-stone-400 leading-relaxed">
            Pick a photo of the spot. You&rsquo;ll be able to drag and zoom to highlight the exact place before it saves.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) pickFile(f)
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full px-3 py-2 bg-emerald-700/40 hover:bg-emerald-600/50 text-emerald-100 text-sm font-medium rounded-lg transition"
          >
            Pick / take a photo
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <CropOverlay
      sourceUrl={sourceUrl}
      busy={busy}
      error={error}
      onCancel={onClose}
      onSkip={uploadOriginal}
      onSave={async (blob) => {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
        await uploadBlob(blob, name)
      }}
    />
  )
}

// Crop / pan / zoom overlay — operates on a local object URL so we can
// canvas-render the framed view before upload. Geometry mirrors the
// existing AvatarEditor pattern (translate + scale).
function CropOverlay({
  sourceUrl,
  busy,
  error,
  onCancel,
  onSkip,
  onSave,
}: {
  sourceUrl: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onSkip: () => void
  onSave: (blob: Blob) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [minScale, setMinScale] = useState(1)
  const maxScale = 6

  // Load the image, compute the fit-to-cover scale, centre it.
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const min = Math.max(VIEWPORT / w, VIEWPORT / h)
      setNatural({ w, h })
      setMinScale(min)
      setScale(min)
      setTx((VIEWPORT - w * min) / 2)
      setTy((VIEWPORT - h * min) / 2)
      imgRef.current = img
      setLoaded(true)
    }
    img.onerror = () => { setLoaded(false); imgRef.current = null }
    img.src = sourceUrl
  }, [sourceUrl])

  function clampTranslate(s: number, x: number, y: number) {
    const minTx = VIEWPORT - natural.w * s
    const minTy = VIEWPORT - natural.h * s
    return { x: Math.min(0, Math.max(minTx, x)), y: Math.min(0, Math.max(minTy, y)) }
  }

  function applyZoom(newScale: number, anchorX = VIEWPORT / 2, anchorY = VIEWPORT / 2) {
    const s = Math.max(minScale, Math.min(maxScale, newScale))
    const ix = (anchorX - tx) / scale
    const iy = (anchorY - ty) / scale
    const newTx = anchorX - ix * s
    const newTy = anchorY - iy * s
    const c = clampTranslate(s, newTx, newTy)
    setScale(s)
    setTx(c.x)
    setTy(c.y)
  }

  // Drag refs — same pattern as AvatarEditor / ThumbnailAdjustOverlay so
  // pointer-capture works the same way across the codebase.
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; pointerId: number | null }>({
    active: false, lastX: 0, lastY: 0, pointerId: null,
  })
  const stateRef = useRef({ scale, tx, ty, natural, minScale })
  stateRef.current = { scale, tx, ty, natural, minScale }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    const st = stateRef.current
    const c = clampTranslate(st.scale, st.tx + dx, st.ty + dy)
    setTx(c.x)
    setTy(c.y)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    d.active = false
    if (d.pointerId != null) { try { e.currentTarget.releasePointerCapture(d.pointerId) } catch {} }
    d.pointerId = null
  }

  // Wheel zoom — non-passive so we can preventDefault.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function wheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const ax = e.clientX - rect.left
      const ay = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const st = stateRef.current
      const next = Math.max(st.minScale, Math.min(maxScale, st.scale * factor))
      const ix = (ax - st.tx) / st.scale
      const iy = (ay - st.ty) / st.scale
      const newTx = ax - ix * next
      const newTy = ay - iy * next
      const c = clampTranslate(next, newTx, newTy)
      setScale(next)
      setTx(c.x)
      setTy(c.y)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  async function save() {
    const img = imgRef.current
    if (!img) return
    // Source rect from the image in image-coords — invert the
    // translate+scale to figure out which area of the natural image
    // currently maps to the VIEWPORT square.
    const sx = -tx / scale
    const sy = -ty / scale
    const sSize = VIEWPORT / scale
    // Output dimension: keep it ≤ OUTPUT_MAX so the resulting JPEG is a
    // reasonable size for blob storage. If the source crop is smaller,
    // don't upscale.
    const out = Math.min(OUTPUT_MAX, Math.round(sSize))
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#1c1917'
    ctx.fillRect(0, 0, out, out)
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, out, out)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (blob) onSave(blob)
  }

  const sliderProgress = minScale === maxScale ? 0 : (scale - minScale) / (maxScale - minScale)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm p-4">
      <div className="rounded-2xl border border-emerald-600/60 bg-stone-900 shadow-2xl p-4 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-200">Frame the spot</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="text-stone-500 hover:text-stone-200 disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>
        <p className="text-[11px] text-stone-500 leading-relaxed">
          Drag to reposition, scroll or use the slider to zoom in on the spot.
        </p>

        <div className="flex justify-center">
          <div
            ref={wrapRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative overflow-hidden rounded-xl bg-stone-950 border border-stone-700 select-none touch-none cursor-grab active:cursor-grabbing"
            style={{ width: VIEWPORT, height: VIEWPORT }}
          >
            {loaded && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: natural.w,
                  height: natural.h,
                  maxWidth: 'none',
                  maxHeight: 'none',
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  transformOrigin: '0 0',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            )}
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center text-stone-500 text-sm">
                Loading…
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => applyZoom(scale / 1.2)}
            disabled={busy || scale <= minScale + 0.001}
            aria-label="Zoom out"
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40"
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(sliderProgress * 1000)}
            onChange={(e) => {
              const p = Number(e.target.value) / 1000
              applyZoom(minScale + (maxScale - minScale) * p)
            }}
            disabled={busy}
            className="flex-1 accent-emerald-500"
          />
          <button
            type="button"
            onClick={() => applyZoom(scale * 1.2)}
            disabled={busy || scale >= maxScale - 0.001}
            aria-label="Zoom in"
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition disabled:opacity-40"
            title="Upload the original photo without adjusting"
          >
            <Forward size={12} />
            Skip adjust
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !loaded}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white rounded-lg transition"
          >
            <Check size={12} />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}
