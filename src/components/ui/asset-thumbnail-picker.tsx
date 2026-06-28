'use client'

// Asset entry thumbnail tile — sits at the top-left of the asset card,
// across from the Type field. Renders the pinned image with a saved
// pan/zoom crop, and exposes:
//
//   • a "Pick" popover to choose which attached image is the thumbnail
//   • an "Adjust" mode to drag-pan + zoom that image to frame the shot
//
// Crop is stored as object-position percentages + a CSS scale in
// customFields (offsetX, offsetY, scale) — purely a render hint, the
// underlying file is never re-encoded. That keeps the editor lossless
// and lets the user re-frame as many times as they want.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Image as ImageIcon, Crop, X, Check, ZoomIn, ZoomOut } from 'lucide-react'
import { setAssetThumbnail } from '@/lib/actions/entries'

interface ImageAttachment {
  id: string
  filename: string
}

interface Crop {
  offsetX: number
  offsetY: number
  scale: number
}

interface Props {
  entryId: string
  currentThumbnailFileId: string | null
  currentCrop: Crop
  imageAttachments: ImageAttachment[]
  canEdit: boolean
}

const DEFAULT_CROP: Crop = { offsetX: 50, offsetY: 50, scale: 1 }

export function AssetThumbnailPicker({
  entryId,
  currentThumbnailFileId,
  currentCrop,
  imageAttachments,
  canEdit,
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  type Mode = 'view' | 'picker' | 'adjust'
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Crop>(currentCrop)
  const [adjustingFileId, setAdjustingFileId] = useState<string | null>(currentThumbnailFileId)

  const active = (adjustingFileId ?? currentThumbnailFileId)
    ? imageAttachments.find((f) => f.id === (adjustingFileId ?? currentThumbnailFileId))
    : null

  async function commit(fileId: string, crop: Crop | null) {
    setBusy(true)
    await setAssetThumbnail(entryId, fileId, crop ?? undefined)
    setBusy(false)
    setMode('view')
    startTransition(() => router.refresh())
  }

  async function clear() {
    setBusy(true)
    await setAssetThumbnail(entryId, '')
    setBusy(false)
    setMode('view')
    startTransition(() => router.refresh())
  }

  function startAdjust(fileId: string) {
    setAdjustingFileId(fileId)
    // Fresh pick → centered + 1x. Re-adjusting an existing pin → load
    // the saved crop so the user keeps their work-in-progress.
    if (fileId !== currentThumbnailFileId) setDraft({ ...DEFAULT_CROP })
    else setDraft({ ...currentCrop })
    setMode('adjust')
  }

  return (
    <div className="relative w-full md:w-auto md:shrink-0">
      {/* The thumbnail tile — fixed height, fluid width so a landscape
          photo can stretch into the available column space (Lance asked
          for this so trucks / boats / panoramas read as the photo's
          natural shape instead of a forced square). On md+, the parent
          flex row still keeps the tile to a max width via min-w-0 on the
          sibling content column, so a wide tile doesn't push the value
          block off-screen — we cap with md:max-w-md as a safety net. */}
      <button
        type="button"
        onClick={() => canEdit && setMode(active ? 'picker' : 'picker')}
        disabled={!canEdit || busy}
        aria-label={active ? 'Change thumbnail' : 'Pick a thumbnail'}
        className={`relative h-40 md:h-48 w-full md:max-w-md rounded-2xl border border-stone-600/60 bg-stone-800/60 overflow-hidden transition ${
          canEdit ? 'hover:border-emerald-500/60' : ''
        }`}
      >
        {active ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${active.id}`}
            alt=""
            draggable={false}
            className="h-full w-full object-cover select-none"
            style={{
              objectPosition: `${currentCrop.offsetX}% ${currentCrop.offsetY}%`,
              transform: `scale(${currentCrop.scale})`,
              transformOrigin: `${currentCrop.offsetX}% ${currentCrop.offsetY}%`,
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-500">
            <ImageIcon size={36} />
          </div>
        )}
      </button>

      {/* Tiny floating "Adjust" pill on the corner of the tile when the
          user has a thumbnail set — drops them straight into pan/zoom
          without having to re-pick the file. */}
      {canEdit && active && mode === 'view' && (
        <button
          type="button"
          onClick={() => startAdjust(active.id)}
          aria-label="Adjust thumbnail crop"
          className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-stone-900/85 hover:bg-stone-800 px-2 py-1 text-[10px] font-medium text-stone-200 border border-stone-600/70"
        >
          <Crop size={11} />
          Adjust
        </button>
      )}

      {/* Picker popover — list of image attachments to swap which one is
          the thumbnail. Picking jumps into Adjust mode so the user can
          frame the shot right after selecting. */}
      {mode === 'picker' && canEdit && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMode('view')} />
          <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-stone-700 bg-stone-900 shadow-xl z-40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-stone-300">Pick thumbnail</p>
              <button
                type="button"
                onClick={() => setMode('view')}
                aria-label="Close picker"
                className="text-stone-500 hover:text-stone-300"
              >
                <X size={13} />
              </button>
            </div>
            {imageAttachments.length === 0 ? (
              <p className="text-xs text-stone-500 leading-relaxed">
                No image attachments yet. Upload a photo to this entry and it&rsquo;ll show up here.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {imageAttachments.map((f) => {
                  const isActive = f.id === currentThumbnailFileId
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => startAdjust(f.id)}
                      disabled={busy}
                      title={f.filename}
                      aria-label={`Use ${f.filename} as thumbnail`}
                      className={`relative h-16 rounded-lg overflow-hidden border transition ${
                        isActive
                          ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                          : 'border-stone-700 hover:border-emerald-500/60'
                      } ${busy ? 'opacity-60' : ''}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${f.id}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </button>
                  )
                })}
              </div>
            )}
            {active && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="w-full text-[11px] text-stone-400 hover:text-red-400 transition pt-1"
              >
                Clear thumbnail
              </button>
            )}
          </div>
        </>
      )}

      {/* Adjust mode — drag the image inside the viewport to pan, slider
          to zoom. Save commits the crop alongside the fileId. */}
      {mode === 'adjust' && canEdit && active && (
        <ThumbnailAdjustOverlay
          fileId={active.id}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          onCancel={() => { setMode('view'); setDraft(currentCrop); setAdjustingFileId(currentThumbnailFileId) }}
          onSave={() => commit(active.id, draft)}
        />
      )}
    </div>
  )
}

// Crop editor overlay — drag + slider + +/- buttons. Lives inside the
// picker so the controls anchor to the tile.
function ThumbnailAdjustOverlay({
  fileId,
  draft,
  setDraft,
  busy,
  onCancel,
  onSave,
}: {
  fileId: string
  draft: Crop
  setDraft: (next: Crop) => void
  busy: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Refs so the pointer handlers always read the latest crop without
  // having to re-bind on every state change.
  const draftRef = useRef(draft)
  draftRef.current = draft

  // Drag state — track the pointer ID + previous client coords so we
  // can compute deltas. Captured on the viewport element so dragging
  // outside the square still pans without releasing.
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number; pointerId: number | null }>({
    active: false, lastX: 0, lastY: 0, pointerId: null,
  })

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d.active) return
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    const dx = e.clientX - d.lastX
    const dy = e.clientY - d.lastY
    d.lastX = e.clientX
    d.lastY = e.clientY
    // Dragging right should pan the FOCAL point LEFT (reveal more of
    // the left side of the image), so we subtract. Divide by box size
    // to convert pixel deltas to object-position percentage units.
    const cur = draftRef.current
    const nextX = clamp(cur.offsetX - (dx / rect.width) * 100, 0, 100)
    const nextY = clamp(cur.offsetY - (dy / rect.height) * 100, 0, 100)
    setDraft({ ...cur, offsetX: nextX, offsetY: nextY })
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    d.active = false
    if (d.pointerId != null) {
      try { e.currentTarget.releasePointerCapture(d.pointerId) } catch {}
    }
    d.pointerId = null
  }

  // Wheel-zoom — non-passive so we can preventDefault scrolling the page.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    function wheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const cur = draftRef.current
      setDraft({ ...cur, scale: clamp(cur.scale * factor, 1, 6) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [setDraft])

  return (
    <div className="absolute left-0 top-0 z-40">
      <div className="rounded-2xl border border-emerald-600/60 bg-stone-900 shadow-2xl p-3 space-y-3">
        <div
          ref={boxRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative h-40 w-40 md:h-48 md:w-48 rounded-xl overflow-hidden bg-stone-950 border border-stone-700 select-none touch-none cursor-grab active:cursor-grabbing"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${fileId}`}
            alt=""
            draggable={false}
            className="h-full w-full object-cover select-none"
            style={{
              objectPosition: `${draft.offsetX}% ${draft.offsetY}%`,
              transform: `scale(${draft.scale})`,
              transformOrigin: `${draft.offsetX}% ${draft.offsetY}%`,
              pointerEvents: 'none',
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft({ ...draft, scale: clamp(draft.scale / 1.2, 1, 6) })}
            disabled={busy || draft.scale <= 1.001}
            aria-label="Zoom out"
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40"
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={1}
            max={6}
            step={0.05}
            value={draft.scale}
            onChange={(e) => setDraft({ ...draft, scale: Number(e.target.value) })}
            disabled={busy}
            aria-label="Zoom"
            className="flex-1 accent-emerald-500"
          />
          <button
            type="button"
            onClick={() => setDraft({ ...draft, scale: clamp(draft.scale * 1.2, 1, 6) })}
            disabled={busy || draft.scale >= 5.999}
            aria-label="Zoom in"
            className="p-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <p className="text-[10px] text-stone-500 leading-relaxed">
          Drag inside the frame to reposition. Scroll or use the slider to zoom.
        </p>

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs text-stone-300 hover:text-stone-100 bg-stone-800 hover:bg-stone-700 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white rounded-lg transition"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
