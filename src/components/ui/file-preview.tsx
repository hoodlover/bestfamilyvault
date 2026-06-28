'use client'

// Inline preview for vault files. Supports images, PDFs, and videos via the
// browser's built-in viewers — fetches from /api/files/{id}?preview=1 so the
// blob ships back with Content-Disposition: inline.
//
// Used from the files-admin browser, the file-list (attached to entries /
// notes / categories), and search results.

import { useEffect, useState } from 'react'
import { Eye, Download, X, ExternalLink } from 'lucide-react'

export interface PreviewableFile {
  id: string
  filename: string
  contentType: string
  size: number
}

export function isPreviewable(contentType: string): boolean {
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    contentType === 'application/pdf'
  )
}

function previewUrl(id: string) {
  return `/api/files/${id}?preview=1`
}

function downloadUrl(id: string) {
  return `/api/files/${id}`
}

interface ButtonProps {
  file: PreviewableFile
  /** Tailwind classes for the trigger button (defaults to a small icon button). */
  className?: string
  /** Override the trigger content. Defaults to an Eye icon. */
  children?: React.ReactNode
  title?: string
}

export function FilePreviewButton({ file, className, children, title }: ButtonProps) {
  const [open, setOpen] = useState(false)
  if (!isPreviewable(file.contentType)) return null
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true) }}
        title={title ?? 'Preview'}
        aria-label="Preview"
        className={
          className ??
          'p-1.5 rounded text-stone-500 hover:text-emerald-400 hover:bg-stone-700 transition'
        }
      >
        {children ?? <Eye size={14} />}
      </button>
      {open && <FilePreviewModal file={file} onClose={() => setOpen(false)} />}
    </>
  )
}

interface ModalProps {
  file: PreviewableFile
  onClose: () => void
}

export function FilePreviewModal({ file, onClose }: ModalProps) {
  // Esc to close. Stop propagation so the dashboard's BackGuard popstate
  // handler doesn't confuse modal-close with leave-the-app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Intercept the device back button so the modal gets first dibs.
  // Bug Lance reported: opening a PDF from search, then tapping back
  // to return to results, exited the PWA entirely and the app reopened
  // at the dashboard. Cause: the modal never pushed a history entry,
  // so back navigated the browser stack one step (past the current
  // route) and ran out of PWA history → OS dropped the app.
  //
  // Fix: push a sentinel entry on mount; a popstate (back press) pops
  // the sentinel and closes the modal in place. On manual close (X /
  // backdrop / Esc), cleanup walks history back to remove the sentinel
  // so we don't leave a phantom entry behind.
  useEffect(() => {
    const STATE_TAG = 'cv-file-preview'
    let popped = false
    try {
      window.history.pushState({ cvModal: STATE_TAG }, '')
    } catch {
      // Sandboxed iframe or storage disabled — fall back to plain modal.
      return
    }
    function onPop() {
      popped = true
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Only pop the sentinel if it's still on top (i.e., the modal was
      // closed manually). If the back button already popped it, doing
      // another history.back() would consume a real history entry and
      // accidentally navigate the user away.
      if (!popped) {
        try { window.history.back() } catch {}
      }
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-stone-800 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-100 truncate" title={file.filename}>{file.filename}</p>
            <p className="text-[11px] text-stone-500">
              {file.contentType} · {formatSize(file.size)}
            </p>
          </div>
          <a
            href={downloadUrl(file.id)}
            title="Download"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition shrink-0"
          >
            <Download size={13} />
            <span className="hidden sm:inline">Download</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-auto">
          <PreviewBody file={file} />
        </div>
      </div>
    </div>
  )
}

function PreviewBody({ file }: { file: PreviewableFile }) {
  const url = previewUrl(file.id)

  if (file.contentType.startsWith('image/')) {
    return (
      // Wider-than-tall (landscape) photos used to overflow the modal —
      // the inline `style={{ maxWidth: 'none' }}` overrode max-w-full and
      // the body's overflow-auto hid the sides behind a horizontal
      // scrollbar most users never noticed. Letting max-w-full win means
      // a landscape photo scales down to fit the modal width, with
      // object-contain preserving aspect ratio.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={file.filename}
        className="block max-w-full max-h-[80vh] object-contain"
      />
    )
  }

  if (file.contentType.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        autoPlay
        className="block max-w-full max-h-[80vh]"
      />
    )
  }

  if (file.contentType === 'application/pdf') {
    return <PdfPreview url={url} filename={file.filename} />
  }

  return (
    <div className="text-stone-400 text-sm p-8 text-center">
      <p>This file type can&rsquo;t be previewed in-browser.</p>
      <a
        href={downloadUrl(file.id)}
        className="mt-3 inline-block text-emerald-400 hover:text-emerald-300 underline"
      >
        Download to open it
      </a>
    </div>
  )
}

// PDF body — desktop gets the inline iframe; touch devices get a big
// tap-to-open button instead. iOS Safari and Android Chrome refuse to
// render PDFs inside same-origin iframes (blank or tiny first-page
// preview) regardless of headers, so the native browser PDF viewer in
// a new tab is the only reliable mobile experience. matchMedia(pointer
// fine) detects a real mouse/trackpad and is the simplest "is this
// desktop" check that also handles touchscreen laptops correctly.
function PdfPreview({ url, filename }: { url: string; filename: string }) {
  const [showInline] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches,
  )
  if (!showInline) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-stone-400">
          PDFs open in your browser&rsquo;s viewer on mobile — tap below.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-700 hover:bg-emerald-600 text-white text-base font-medium rounded-xl transition shadow-lg shadow-emerald-900/50"
        >
          <ExternalLink size={18} />
          Open {filename}
        </a>
      </div>
    )
  }
  return (
    <iframe
      src={url}
      title={filename}
      className="w-full h-[80vh] border-0 bg-white"
    />
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
