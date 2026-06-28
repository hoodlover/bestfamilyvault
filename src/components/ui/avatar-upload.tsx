'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, X, UserRound, ZoomIn, ZoomOut, RotateCcw, Pencil, Trash2 } from 'lucide-react'
import { updateAvatar, removeAvatar } from '@/lib/actions/settings'
import { compressImage } from '@/lib/image-compress'
import { formatBytes } from '@/lib/format'

interface Props {
  currentImage: string | null
  currentImageOriginal: string | null
  displayName: string | null
}

// Hard ceiling AFTER compression — anything bigger means the photo is
// extraordinary (a multi-shot panorama, etc.) and we'd rather refuse than
// silently degrade quality further.
const MAX_BYTES_AFTER_COMPRESS = 4 * 1024 * 1024 // 4 MB
const VIEWPORT = 280 // px on screen
const OUTPUT = 320 // px exported

interface Source {
  /** Object URL or http URL */
  url: string
  /** When user just picked a new file, we keep it so it can be uploaded as the original */
  file: File | null
}

export function AvatarUpload({ currentImage, currentImageOriginal, displayName }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initial = (displayName ?? '?').trim().charAt(0).toUpperCase() || '?'

  async function pickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('File must be an image.')
      return
    }
    setError(null)
    // Run every photo through the browser-side downsizer first. Heather can
    // pick any iPhone photo (even 12 MB HEIC originals on Safari 17+) and
    // we'll get a sub-MB JPEG to feed the cropper.
    setCompressing(true)
    try {
      const shrunk = await compressImage(file, { maxDim: 1600, quality: 0.85 })
      setCompressing(false)
      if (shrunk.size > MAX_BYTES_AFTER_COMPRESS) {
        setError(
          `That photo is unusually large even after compressing (${formatBytes(shrunk.size)}). ` +
          `Try a different one or save it as JPEG first.`
        )
        return
      }
      setSource({ url: URL.createObjectURL(shrunk), file: shrunk })
    } catch (err) {
      setCompressing(false)
      setError(err instanceof Error ? err.message : 'Could not process this photo.')
    }
  }

  function editExisting() {
    const url = currentImageOriginal ?? currentImage
    if (!url) return
    setError(null)
    setSource({ url, file: null })
  }

  function cancelEditor() {
    if (source?.url.startsWith('blob:')) URL.revokeObjectURL(source.url)
    setSource(null)
    setError(null)
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    await removeAvatar()
    setBusy(false)
    router.refresh()
  }

  async function handleSave(croppedBlob: Blob) {
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.append('avatar', new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' }))
    if (source?.file) fd.append('original', source.file)
    const result = await updateAvatar(fd)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    cancelEditor()
    router.refresh()
  }

  // Idle UI
  if (!source) {
    return (
      <div className="flex items-start gap-5">
        <div className="relative w-24 h-24 rounded-full overflow-hidden bg-stone-700 border border-stone-600 flex items-center justify-center shrink-0">
          {currentImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl font-semibold text-stone-300">{initial || <UserRound size={32} />}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-400 mb-3">
            Pick any photo — we&apos;ll shrink it for you. Square shots look best.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) pickFile(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy || compressing}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-700 hover:bg-stone-600 text-stone-100 rounded-lg transition disabled:opacity-50"
            >
              {compressing ? (
                <>
                  <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  Shrinking…
                </>
              ) : (
                <>
                  <Upload size={14} />
                  {currentImage ? 'Upload new' : 'Upload photo'}
                </>
              )}
            </button>
            {currentImage && (
              <button
                type="button"
                onClick={editExisting}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-amber-700 hover:bg-amber-600 text-white rounded-lg transition disabled:opacity-50"
                title={currentImageOriginal ? 'Re-crop and zoom your existing photo' : 'Adjust your existing photo'}
              >
                <Pencil size={14} />
                Adjust crop
              </button>
            )}
            {currentImage && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-red-900/40 text-stone-400 hover:text-red-300 border border-stone-700 hover:border-red-800/50 rounded-lg transition"
              >
                <Trash2 size={14} />
                Remove
              </button>
            )}
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  // Editor
  return (
    <AvatarEditor
      sourceUrl={source.url}
      busy={busy}
      error={error}
      onSave={handleSave}
      onCancel={cancelEditor}
    />
  )
}

interface EditorProps {
  sourceUrl: string
  busy: boolean
  error: string | null
  onSave: (blob: Blob) => void
  onCancel: () => void
}

function AvatarEditor({ sourceUrl, busy, error, onSave, onCancel }: EditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [minScale, setMinScale] = useState(1)
  const maxScale = 6

  // Load image, compute initial fit-to-cover scale + center it
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
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
    img.onerror = () => {
      imgRef.current = null
      setLoaded(false)
    }
    img.src = sourceUrl
  }, [sourceUrl])

  // Clamp translation so the image always covers the viewport
  function clampTranslate(s: number, x: number, y: number) {
    const minTx = VIEWPORT - natural.w * s
    const minTy = VIEWPORT - natural.h * s
    return {
      x: Math.min(0, Math.max(minTx, x)),
      y: Math.min(0, Math.max(minTy, y)),
    }
  }

  function applyZoom(newScale: number, anchorX = VIEWPORT / 2, anchorY = VIEWPORT / 2) {
    const s = Math.max(minScale, Math.min(maxScale, newScale))
    // Keep the image point under the anchor stationary
    const ix = (anchorX - tx) / scale
    const iy = (anchorY - ty) / scale
    const newTx = anchorX - ix * s
    const newTy = anchorY - iy * s
    const c = clampTranslate(s, newTx, newTy)
    setScale(s)
    setTx(c.x)
    setTy(c.y)
  }

  // Refs mirror the latest state values so handlers can read them without
  // having to be re-bound on every state change.
  const scaleRef = useRef(scale)
  const txRef = useRef(tx)
  const tyRef = useRef(ty)
  const naturalRef = useRef(natural)
  const minScaleRef = useRef(minScale)
  scaleRef.current = scale
  txRef.current = tx
  tyRef.current = ty
  naturalRef.current = natural
  minScaleRef.current = minScale

  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; pointerId: number | null }>({
    active: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
  })

  function clampTranslateRef(s: number, x: number, y: number) {
    const minTx = VIEWPORT - naturalRef.current.w * s
    const minTy = VIEWPORT - naturalRef.current.h * s
    return {
      x: Math.min(0, Math.max(minTx, x)),
      y: Math.min(0, Math.max(minTy, y)),
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      pointerId: e.pointerId,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d.active) return
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    const c = clampTranslateRef(scaleRef.current, txRef.current + dx, tyRef.current + dy)
    setTx(c.x)
    setTy(c.y)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    d.active = false
    if (d.pointerId !== null) {
      try { e.currentTarget.releasePointerCapture(d.pointerId) } catch {}
    }
    d.pointerId = null
  }

  // Wheel must be a non-passive listener to call preventDefault, so it stays
  // imperative — but bound once per element, reading state through refs.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function wheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const ax = e.clientX - rect.left
      const ay = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      // Inline applyZoom logic against refs to avoid stale-closure issues.
      const nextScale = Math.max(
        minScaleRef.current,
        Math.min(maxScale, scaleRef.current * factor)
      )
      const ix = (ax - txRef.current) / scaleRef.current
      const iy = (ay - tyRef.current) / scaleRef.current
      const newTx = ax - ix * nextScale
      const newTy = ay - iy * nextScale
      const c = clampTranslateRef(nextScale, newTx, newTy)
      setScale(nextScale)
      setTx(c.x)
      setTy(c.y)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  function reset() {
    setScale(minScale)
    setTx((VIEWPORT - natural.w * minScale) / 2)
    setTy((VIEWPORT - natural.h * minScale) / 2)
  }

  async function save() {
    const img = imgRef.current
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Fill with white in case of transparency
    ctx.fillStyle = '#1c1917' // stone-900
    ctx.fillRect(0, 0, OUTPUT, OUTPUT)
    const sx = -tx / scale
    const sy = -ty / scale
    const sSize = VIEWPORT / scale
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    )
    if (blob) onSave(blob)
  }

  const sliderProgress = minScale === maxScale ? 0 : (scale - minScale) / (maxScale - minScale)

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-400">
        Drag to reposition, scroll or use the slider to zoom. The circle shows what your avatar will look like.
      </p>

      <div className="flex flex-col items-center gap-4">
        <div
          ref={wrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative overflow-hidden bg-stone-950 border border-stone-700 select-none touch-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEWPORT, height: VIEWPORT, borderRadius: '50%' }}
        >
          {loaded && imgRef.current && (
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
                // Tailwind v4 preflight applies max-width: 100% to all <img>,
                // which would clip this element to the 280px viewport while the
                // inline height stayed at natural.h — squashing the photo to a
                // sliver. Override both dimension caps so the transform-based
                // scaling controls the final visual size.
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
              Loading...
            </div>
          )}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-3 w-full max-w-md">
          <button
            type="button"
            onClick={() => applyZoom(scale / 1.2)}
            disabled={busy || scale <= minScale + 0.001}
            className="p-2 rounded-lg bg-stone-700 hover:bg-stone-600 text-stone-200 disabled:opacity-40"
            title="Zoom out"
          >
            <ZoomOut size={16} />
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
            className="flex-1 accent-amber-500"
          />
          <button
            type="button"
            onClick={() => applyZoom(scale * 1.2)}
            disabled={busy || scale >= maxScale - 0.001}
            className="p-2 rounded-lg bg-stone-700 hover:bg-stone-600 text-stone-200 disabled:opacity-40"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300"
            title="Reset"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition"
        >
          <X size={14} />
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !loaded}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white rounded-lg transition"
        >
          {busy ? (
            <>
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Upload size={14} />
              Save photo
            </>
          )}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
