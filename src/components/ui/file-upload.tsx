'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, X, FileText, Image, File as FileIconLucide, Camera, Copy, Sparkles, ScanLine } from 'lucide-react'
import { uploadFile } from '@/lib/actions/files'
import { formatBytes } from '@/lib/format'
import { compressImage } from '@/lib/image-compress'
import { CameraCapture } from './camera-capture'
import { DocScannerEditor } from './doc-scanner-editor'

interface FileUploadProps {
  entryId?: string
  noteId?: string
  categoryId?: string
  isPrivate?: boolean
}

function FileIcon({ type }: { type: string }) {
  if (type.startsWith('image/')) return <Image size={16} className="text-blue-400" />
  if (type === 'application/pdf') return <FileText size={16} className="text-red-400" />
  return <FileIconLucide size={16} className="text-stone-400" />
}

// Per-file state in the upload queue. Compression + upload happen lazily
// inside the worker pool so memory stays bounded — holding 400 File
// objects is cheap (they're disk-backed), reading 400 of them into
// ArrayBuffers at once is not.
type FileStatus = 'queued' | 'compressing' | 'uploading' | 'done' | 'failed'
interface QueuedFile {
  id: string
  file: File
  originalSize: number
  status: FileStatus
  error?: string
}

// Concurrency for bulk uploads — 5 keeps the network busy without
// drowning the server in simultaneous /upload calls. Each call routes
// through a single uploadFile() server action that PUTs to Vercel Blob,
// so the bottleneck is upstream bandwidth, not Node.
const UPLOAD_CONCURRENCY = 5

const MAX_FILE_BYTES = 50 * 1024 * 1024
const ITEM_ID_PREFIX = 'qf-'

function nextId(): string {
  return `${ITEM_ID_PREFIX}${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export function FileUpload({ entryId, noteId, categoryId, isPrivate }: FileUploadProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [ocrCopied, setOcrCopied] = useState(false)
  // For the SINGLE-file affordance set (camera, scanner, OCR). Tracks the
  // index of the queue entry the user is acting on. When the queue is
  // length 1, all single-file UI applies to queue[0].
  const singleIndex = queue.length === 1 ? 0 : null
  const single = singleIndex !== null ? queue[singleIndex] : null

  function addFiles(rawFiles: FileList | File[]) {
    setError(null)
    const incoming: QueuedFile[] = []
    const arr = Array.from(rawFiles)
    for (const f of arr) {
      // Reject non-image files over the hard limit up front so the user
      // sees it in the queue list rather than mid-upload. Images get a
      // shot at compression first; we let oversized ones into the queue
      // and reject during the compress step if shrink doesn't help.
      if (f.size > MAX_FILE_BYTES && !f.type.startsWith('image/')) {
        incoming.push({
          id: nextId(),
          file: f,
          originalSize: f.size,
          status: 'failed',
          error: `Over 50 MB (${formatBytes(f.size)})`,
        })
        continue
      }
      incoming.push({
        id: nextId(),
        file: f,
        originalSize: f.size,
        status: 'queued',
      })
    }
    setQueue((prev) => [...prev, ...incoming])
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }

  function clearAll() {
    setQueue([])
    setOcrText(null)
    setOcrCopied(false)
  }

  // OCR + scanner are single-file affordances — they no-op when the queue
  // has 0 or >1 items.
  async function runCloudOcr() {
    if (!single || !single.file.type.startsWith('image/')) return
    setOcrBusy(true)
    setOcrText(null)
    setOcrCopied(false)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', single.file)
      const res = await fetch('/api/ocr-cloud', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Cloud OCR failed (${res.status})`)
      }
      const data = (await res.json()) as { text?: string; engine?: 'google' | 'claude' }
      setOcrText((data.text ?? '').trim() || '(no text detected)')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloud OCR failed.')
    } finally {
      setOcrBusy(false)
    }
  }

  async function copyOcr() {
    if (!ocrText) return
    try {
      await navigator.clipboard.writeText(ocrText)
      setOcrCopied(true)
      setTimeout(() => setOcrCopied(false), 1800)
    } catch {
      /* user can long-press the textarea */
    }
  }

  // Replace a single-file queue entry with a transformed version
  // (e.g. the doc-scanner output). The cumulative original size is
  // tracked so the "shrunk from X" indicator stays honest after
  // both compression and scanning.
  function replaceSingle(file: File) {
    if (singleIndex === null) return
    setQueue((prev) => {
      const copy = [...prev]
      const existing = copy[singleIndex]
      copy[singleIndex] = {
        ...existing,
        file,
        originalSize: Math.max(existing.originalSize, file.size),
        status: 'queued',
        error: undefined,
      }
      return copy
    })
    setOcrText(null)
    setOcrCopied(false)
  }

  // Compress a single image client-side. Non-images / SVG / GIF return
  // the original. Throws on failure — caller handles per-file.
  async function compressIfImage(f: File): Promise<File> {
    if (!f.type.startsWith('image/') || f.type === 'image/gif' || f.type === 'image/svg+xml') {
      return f
    }
    const compressed = await compressImage(f)
    if (compressed.size > MAX_FILE_BYTES) {
      throw new Error(`Still over 50 MB after compression (${formatBytes(compressed.size)}).`)
    }
    return compressed
  }

  async function processOne(item: QueuedFile): Promise<void> {
    // Compression phase — only for images that haven't already been
    // shrunk (handled in addFiles' cumulative tracking via originalSize).
    let toUpload = item.file
    setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'compressing' } : q)))
    try {
      toUpload = await compressIfImage(item.file)
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'failed', error: err instanceof Error ? err.message : 'Compression failed.' }
            : q,
        ),
      )
      return
    }

    setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading' } : q)))
    const fd = new FormData()
    fd.append('file', toUpload)
    if (entryId) fd.append('entryId', entryId)
    if (noteId) fd.append('noteId', noteId)
    if (categoryId) fd.append('categoryId', categoryId)
    if (isPrivate) fd.append('isPrivate', 'true')

    try {
      const result = await uploadFile(fd)
      if (result?.error) {
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'failed', error: result.error } : q)),
        )
        return
      }
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'done' } : q)))
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: 'failed', error: err instanceof Error ? err.message : 'Upload failed.' }
            : q,
        ),
      )
    }
  }

  // Worker-pool style upload — UPLOAD_CONCURRENCY workers pull from the
  // queued list until empty. Reads queue state via a ref-snapshot pattern
  // so workers don't all grab the same item.
  async function startUploads() {
    if (uploading) return
    setUploading(true)
    setError(null)

    const queuedSnapshot = queue.filter((q) => q.status === 'queued')
    let cursor = 0
    async function worker() {
      while (true) {
        const idx = cursor++
        if (idx >= queuedSnapshot.length) return
        await processOne(queuedSnapshot[idx])
      }
    }
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queuedSnapshot.length) }, () => worker())
    await Promise.all(workers)
    setUploading(false)
    // Refresh the route so the parent's attachment list re-renders with
    // the newly-saved files.
    router.refresh()
  }

  // Auto-clear `done` items shortly after all uploads finish so the queue
  // doesn't grow forever across bulk batches. Failed rows stay visible
  // until the user dismisses them so they don't get silently lost.
  useEffect(() => {
    if (uploading) return
    const allTerminal = queue.length > 0 && queue.every((q) => q.status === 'done' || q.status === 'failed')
    if (!allTerminal) return
    const allDone = queue.every((q) => q.status === 'done')
    if (!allDone) return
    const t = setTimeout(() => setQueue([]), 1500)
    return () => clearTimeout(t)
  }, [queue, uploading])

  // Paste-to-upload: Lance asked for the ability to copy a screenshot
  // (Win+Shift+S / Cmd+Shift+4+Ctrl / phone screenshot share) and Ctrl+V
  // it straight onto the entry. We listen at document level so the user
  // doesn't need to focus a specific drop zone — any Ctrl+V while
  // FileUpload is mounted with an image in the clipboard adds it to the
  // queue. Plain-text pastes fall through untouched (we only
  // preventDefault when an image is actually present). Pasted images
  // come in as "image.png" with no useful name; we rename them to
  // `screenshot-<timestamp>.<ext>` so the attachment list shows
  // something distinguishable.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const items = e.clipboardData.items
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue
        if (!item.type.startsWith('image/')) continue
        const f = item.getAsFile()
        if (!f) continue
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const ext = (f.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')
        const renamed = new File(
          [f],
          imageFiles.length === 0 ? `screenshot-${ts}.${ext}` : `screenshot-${ts}-${imageFiles.length + 1}.${ext}`,
          { type: f.type, lastModified: f.lastModified },
        )
        imageFiles.push(renamed)
      }
      if (imageFiles.length === 0) return
      e.preventDefault()
      addFiles(imageFiles)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // addFiles is stable for our purposes — it only calls setError +
    // setQueue (both stable). Mount once, listen until unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneCount = queue.filter((q) => q.status === 'done').length
  const failedCount = queue.filter((q) => q.status === 'failed').length
  const queuedCount = queue.filter((q) => q.status === 'queued').length
  const inflightCount = queue.filter((q) => q.status === 'uploading' || q.status === 'compressing').length

  return (
    <div>
      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            setCameraOpen(false)
            addFiles([file])
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {scannerOpen && single && single.file.type.startsWith('image/') && (
        <DocScannerEditor
          file={single.file}
          onAccept={(scanned) => {
            setScannerOpen(false)
            replaceSingle(scanned)
          }}
          onCancel={() => setScannerOpen(false)}
        />
      )}

      {/* Drop zone — visible while there's room to add more files. We
          show it even when the queue has items so the user can append
          additional batches before starting the upload. */}
      <div className="space-y-2">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition ${
            dragging
              ? 'border-emerald-600 bg-emerald-600/5'
              : 'border-stone-700 hover:border-stone-600 hover:bg-stone-800/40'
          }`}
        >
          <Upload size={20} className="text-stone-500" />
          <p className="text-sm text-stone-500">
            <span className="text-stone-300 font-medium">Click to upload</span>, drag and drop, or paste a screenshot
          </p>
          <p className="text-xs text-stone-600">Pick one or many · photos shrink automatically · 50 MB max each</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        {queue.length === 0 && (
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-stone-700 bg-stone-900/40 text-sm font-medium text-stone-200 hover:border-stone-600 hover:bg-stone-800/60 transition"
          >
            <Camera size={15} className="text-emerald-400" />
            Take a photo with the camera
          </button>
        )}
        {/* Camera state — uses getUserMedia to force the back camera
            reliably; the native <input capture="environment"> attribute
            is honoured inconsistently on iOS Safari and tends to open
            whatever camera mode was last used in the camera app. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* Queue + bulk controls */}
      {queue.length > 0 && (
        <div className="mt-3 space-y-2">
          {/* Header — file counts + Upload All / Clear */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-stone-400">
              {queue.length} file{queue.length === 1 ? '' : 's'} ready
              {doneCount > 0 && <span className="text-emerald-400"> · {doneCount} done</span>}
              {failedCount > 0 && <span className="text-red-400"> · {failedCount} failed</span>}
              {inflightCount > 0 && <span className="text-amber-300"> · {inflightCount} in flight</span>}
            </p>
            <div className="flex items-center gap-2">
              {!uploading && queuedCount > 0 && (
                <button
                  type="button"
                  onClick={startUploads}
                  className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 shadow-lg shadow-green-500/50 text-white text-sm font-medium rounded-lg transition"
                >
                  <Upload size={13} />
                  Upload {queuedCount === 1 ? 'file' : `all ${queuedCount}`}
                </button>
              )}
              {uploading && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 text-stone-200 text-sm">
                  <span className="w-3 h-3 border border-emerald-300 border-t-transparent rounded-full animate-spin" />
                  Uploading {doneCount}/{queue.length}…
                </span>
              )}
              {!uploading && queue.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-stone-400 hover:text-stone-200 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Per-file rows. Capped at 12 rows visible, the rest live
              inside a scrollable region so 400 files don't paint a
              4000-px-tall list. */}
          <ul className="max-h-72 overflow-y-auto divide-y divide-stone-800 border border-stone-700/50 rounded-xl bg-stone-900/30">
            {queue.map((q) => (
              <li key={q.id} className="flex items-center gap-3 px-3 py-2">
                <FileIcon type={q.file.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-200 truncate">{q.file.name}</p>
                  <p className="text-[11px] text-stone-500">
                    {formatBytes(q.file.size)}
                    {q.error && <span className="text-red-400"> · {q.error}</span>}
                  </p>
                </div>
                <StatusPill status={q.status} />
                {!uploading && q.status !== 'uploading' && q.status !== 'compressing' && (
                  <button
                    type="button"
                    onClick={() => removeFromQueue(q.id)}
                    aria-label="Remove from queue"
                    className="p-1 text-stone-500 hover:text-stone-200 hover:bg-stone-800 rounded transition"
                  >
                    <X size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Single-file affordances: doc scan + OCR. These only make sense
          for one file at a time, so they vanish in bulk mode. */}
      {single && single.file.type.startsWith('image/') && single.file.type !== 'image/svg+xml' && single.file.type !== 'image/gif' && !uploading && (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-stone-900/40 hover:bg-stone-800/60 text-stone-200 border border-stone-700 hover:border-stone-600 rounded-lg transition"
            title="Drag corners over a document, straighten and clean up."
          >
            <ScanLine size={13} className="text-emerald-400" />
            Scan &amp; crop document
          </button>
          <div className="rounded-xl border border-stone-700/50 bg-stone-800/40 p-3">
            {!ocrText && !ocrBusy && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={runCloudOcr}
                  title="Use Claude Vision to read text from this image."
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-900/30 hover:bg-amber-900/50 text-amber-200 border border-amber-700/50 rounded-lg transition"
                >
                  <Sparkles size={13} className="text-amber-400" />
                  Read text
                </button>
              </div>
            )}
            {ocrBusy && (
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-stone-300">Reading text...</p>
              </div>
            )}
            {ocrText && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-stone-400">
                    Extracted text
                    <span className="ml-2 text-stone-600 font-normal normal-case tracking-normal">Claude Vision</span>
                  </span>
                  <button
                    type="button"
                    onClick={copyOcr}
                    className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition"
                  >
                    <Copy size={11} />
                    {ocrCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={ocrText}
                  rows={Math.min(10, Math.max(3, ocrText.split('\n').length))}
                  className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700 rounded-lg text-stone-100 text-xs resize-y font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] text-stone-500">
                    Paste this into the note. OCR uses Claude Vision.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-400">{error}</p>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: FileStatus }) {
  if (status === 'queued') return <span className="text-[10px] text-stone-500">Queued</span>
  if (status === 'compressing') return <span className="inline-flex items-center gap-1 text-[10px] text-amber-300"><span className="w-2 h-2 border border-amber-300 border-t-transparent rounded-full animate-spin" />Shrink</span>
  if (status === 'uploading') return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300"><span className="w-2 h-2 border border-emerald-300 border-t-transparent rounded-full animate-spin" />Upload</span>
  if (status === 'done') return <span className="text-[10px] text-emerald-400">Done</span>
  return <span className="text-[10px] text-red-400">Failed</span>
}
