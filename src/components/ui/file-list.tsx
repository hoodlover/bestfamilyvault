'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileText, Image as ImageIcon, Download, Pencil, Trash2, File, Sparkles, Send, X, RotateCw } from 'lucide-react'
import { deleteFile, renameFile, rotateFile } from '@/lib/actions/files'
import { formatBytes } from '@/lib/format'
import { FilePreviewButton, isPreviewable } from './file-preview'
import type { InferSelectModel } from 'drizzle-orm'
import type { files } from '@/lib/db/schema'

type FileRecord = InferSelectModel<typeof files>

const ASKABLE_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])

function FileIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) return <ImageIcon size={16} className="text-blue-400" />
  if (contentType === 'application/pdf') return <FileText size={16} className="text-red-400" />
  return <File size={16} className="text-stone-400" />
}

export function FileList({ files, canDelete }: { files: FileRecord[]; canDelete: boolean }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [rotating, setRotating] = useState<string | null>(null)
  // id of the file currently being renamed, and the in-flight new name.
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  async function handleDelete(id: string) {
    if (confirmingDelete !== id) {
      setConfirmingDelete(id)
      return
    }
    setDeleting(id)
    await deleteFile(id)
    setDeleting(null)
    setConfirmingDelete(null)
    router.refresh()
  }

  async function handleRotate(id: string) {
    setRotating(id)
    await rotateFile(id)
    setRotating(null)
    // Cache-busts the proxied URL too (Cache-Control is no-cache, but force
    // a refetch by re-rendering the parent so the new rotation shows).
    router.refresh()
  }

  function startRename(id: string, currentName: string) {
    setRenaming(id)
    setRenameText(currentName)
    // Focus + select after the input renders.
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 0)
  }

  async function commitRename(id: string) {
    const next = renameText.trim()
    if (!next) { setRenaming(null); return }
    await renameFile(id, next)
    setRenaming(null)
    setRenameText('')
    router.refresh()
  }

  function cancelRename() {
    setRenaming(null)
    setRenameText('')
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div key={file.id} onMouseLeave={() => setConfirmingDelete((cur) => (cur === file.id ? null : cur))}>
          {/* Two-row layout: filename + size on top so the name has the
              full width, action icons on their own row below. Previous
              one-line layout buried the filename behind 5–6 action icons
              on mobile — Lance flagged it as unreadable. */}
          <div className="p-3 bg-stone-800/60 border border-stone-700/50 rounded-xl space-y-2">
            <div className="flex items-center gap-3 min-w-0">
              <FileIcon contentType={file.contentType} />
              <div className="flex-1 min-w-0">
                {renaming === file.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(file.id) }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                    }}
                    onBlur={() => commitRename(file.id)}
                    className="w-full px-2 py-1 -ml-2 bg-stone-900 border border-emerald-700 rounded text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  />
                ) : (
                  <p className="text-sm text-stone-200 break-all" title={file.filename}>{file.filename}</p>
                )}
                <p className="text-xs text-stone-500">{formatBytes(file.size)}</p>
              </div>
            </div>
            {/* Action row — left-aligned so the icons read as a toolbar
                for the file above. Hidden during rename so the input
                isn't crowded. */}
            {renaming !== file.id && (
              <div className="flex items-center gap-1 flex-wrap">
                {ASKABLE_TYPES.has(file.contentType) && (
                  <button
                    onClick={() => setAsking((cur) => (cur === file.id ? null : file.id))}
                    title={asking === file.id ? 'Close' : 'Ask Claude about this file'}
                    className={`p-1.5 rounded-lg transition ${
                      asking === file.id
                        ? 'text-emerald-300 bg-emerald-900/30 border border-emerald-700/40'
                        : 'text-stone-400 hover:text-emerald-300 hover:bg-stone-700'
                    }`}
                  >
                    {asking === file.id ? <X size={14} /> : <Sparkles size={14} />}
                  </button>
                )}
                {isPreviewable(file.contentType) && (
                  <FilePreviewButton
                    file={{ id: file.id, filename: file.filename, contentType: file.contentType, size: file.size }}
                    className="p-1.5 text-stone-400 hover:text-emerald-400 hover:bg-stone-700 rounded-lg transition"
                  />
                )}
                {canDelete && file.contentType.startsWith('image/') && (
                  <button
                    onClick={() => handleRotate(file.id)}
                    disabled={rotating === file.id}
                    title="Rotate 90°"
                    aria-label="Rotate 90 degrees"
                    className="p-1.5 text-stone-400 hover:text-emerald-300 hover:bg-stone-700 rounded-lg transition disabled:opacity-40"
                  >
                    <RotateCw size={14} />
                  </button>
                )}
                <a
                  href={`/api/files/${file.id}`}
                  className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-700 rounded-lg transition"
                  title="Download"
                  aria-label="Download"
                >
                  <Download size={14} />
                </a>
                {canDelete && (
                  <button
                    onClick={() => startRename(file.id, file.filename)}
                    title="Rename file"
                    aria-label="Rename file"
                    className="p-1.5 text-stone-500 hover:text-emerald-300 hover:bg-stone-700 rounded-lg transition"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => handleDelete(file.id)}
                    disabled={deleting === file.id}
                    title={confirmingDelete === file.id ? 'Click again to delete' : 'Delete file'}
                    aria-label={confirmingDelete === file.id ? 'Confirm delete file' : 'Delete file'}
                    className={`p-1.5 rounded-lg transition disabled:opacity-40 ${
                      confirmingDelete === file.id
                        ? 'bg-red-950/60 text-red-300 ring-1 ring-red-700/70'
                        : 'text-stone-500 hover:text-red-400 hover:bg-stone-700'
                    }`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
            {/* Rename mode keeps a single Save icon visible so the user
                has a non-Enter affordance to commit. */}
            {canDelete && renaming === file.id && (
              <div className="flex items-center gap-1">
                <button
                  onMouseDown={(e) => e.preventDefault() /* don't blur the input */}
                  onClick={() => commitRename(file.id)}
                  title="Save name"
                  aria-label="Save name"
                  className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-stone-700 rounded-lg transition"
                >
                  <Check size={14} />
                </button>
              </div>
            )}
          </div>
          {asking === file.id && (
            <AskPanel fileId={file.id} filename={file.filename} />
          )}
        </div>
      ))}
    </div>
  )
}

function AskPanel({ fileId, filename }: { fileId: string; filename: string }) {
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<{ q: string; a: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (!question) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ask-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, question }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setHistory((h) => [...h, { q: question, a: data.answer }])
        setQ('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-9 mt-1 mb-2 rounded-xl border border-emerald-700/30 bg-emerald-950/15 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/70 font-semibold flex items-center gap-1.5">
        <Sparkles size={11} />
        Ask about {filename}
      </p>
      {history.map((turn, i) => (
        <div key={i} className="space-y-1">
          <p className="text-xs text-stone-400">{turn.q}</p>
          <p className="text-sm text-stone-100 whitespace-pre-wrap leading-relaxed">{turn.a}</p>
        </div>
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <form onSubmit={ask} className="flex items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="What's the closing balance? When is this due?"
          disabled={busy}
          className="flex-1 px-3 py-1.5 text-sm bg-black/30 border border-emerald-700/30 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-700/40 hover:bg-emerald-600/50 disabled:bg-emerald-900/40 disabled:opacity-50 text-emerald-100 rounded-lg transition"
        >
          {busy ? <span className="w-3 h-3 border border-emerald-200 border-t-transparent rounded-full animate-spin" /> : <Send size={12} />}
          Ask
        </button>
      </form>
    </div>
  )
}
