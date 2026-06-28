'use client'

// Inbox client island — Android-share-only queue. Files arrive via the
// PWA's share-target route (/inbox/share, called by Android's Share
// sheet when Lance picks Family Vault as a destination) and surface here.
// Each row gets actions to attach the file to an existing entry or
// delete it. NO desktop drop-zone is rendered here on purpose — desktop
// drops belong in the existing Vault File Drop pipeline at /import,
// which has Claude-driven smart routing this dumb queue intentionally
// doesn't duplicate.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, File as FileIcon, Trash2, Link2, Check, Search } from 'lucide-react'
import { formatBytes } from '@/lib/format'
import { attachInboxFileToEntry, deleteInboxFile } from '@/lib/actions/inbox'
import { searchVault } from '@/lib/actions/entries'

interface InboxRow {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: string
}

export function InboxClient({ rows }: { rows: InboxRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-700/60 bg-stone-900/40 p-10 text-center">
        <p className="text-sm text-stone-400 leading-relaxed">
          Nothing waiting. Share a file from your phone&rsquo;s Share menu
          (pick <strong>Family Vault</strong>) and it&rsquo;ll land here.
        </p>
        <p className="text-xs text-stone-500 mt-2">
          For desktop drops, use the Vault File Drop folder on the import page instead.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <InboxItem key={row.id} row={row} />
      ))}
    </div>
  )
}

// ─── One inbox row ──────────────────────────────────────────────────────────

function InboxItem({ row }: { row: InboxRow }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)

  async function handleDelete() {
    if (!confirmingDelete) { setConfirmingDelete(true); return }
    setBusy(true)
    await deleteInboxFile(row.id)
    setBusy(false)
    setConfirmingDelete(false)
    router.refresh()
  }

  async function handleAttach(entryId: string) {
    setBusy(true)
    await attachInboxFileToEntry(row.id, entryId)
    setBusy(false)
    setAttachOpen(false)
    router.refresh()
  }

  const isImage = row.contentType.startsWith('image/')
  const thumbHref = isImage ? `/api/files/${row.id}?preview=1` : null

  return (
    <div className="rounded-xl border border-stone-700/50 bg-stone-800/60 p-3 md:p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          {thumbHref ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbHref} alt="" className="h-12 w-12 md:h-14 md:w-14 object-cover rounded-lg border border-stone-700" />
          ) : (
            <div className="h-12 w-12 md:h-14 md:w-14 rounded-lg bg-stone-900 border border-stone-700 flex items-center justify-center">
              {row.contentType === 'application/pdf' ? <FileText size={20} className="text-red-400" /> : <FileIcon size={20} className="text-stone-400" />}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-100 break-all" title={row.filename}>
            {row.filename}
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            {formatBytes(row.size)} · {new Date(row.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setAttachOpen((v) => !v)}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-emerald-700/40 hover:bg-emerald-600/50 text-emerald-100 rounded-md transition"
        >
          <Link2 size={12} />
          {attachOpen ? 'Cancel attach' : 'Attach to entry…'}
        </button>
        <Link
          href={`/api/files/${row.id}`}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-md transition"
        >
          Download
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md transition border ${
            confirmingDelete
              ? 'bg-red-950/60 text-red-200 border-red-700/60'
              : 'bg-stone-800 hover:bg-stone-700 text-stone-400 border-stone-700'
          }`}
          title={confirmingDelete ? 'Click again to confirm' : 'Delete'}
        >
          <Trash2 size={12} />
          {confirmingDelete ? 'Confirm' : 'Delete'}
        </button>
      </div>
      {attachOpen && (
        <AttachPicker onPick={handleAttach} onCancel={() => setAttachOpen(false)} busy={busy} />
      )}
    </div>
  )
}

// ─── Entry picker (search-as-you-type) ──────────────────────────────────────

function AttachPicker({ onPick, onCancel, busy }: { onPick: (entryId: string) => void; onCancel: () => void; busy: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; title: string; type: string }[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const r = await searchVault(q)
        if (cancelled) return
        setResults(r.entries.slice(0, 12).map((e) => ({ id: e.id, title: e.title, type: e.type })))
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query])

  return (
    <div className="mt-3 rounded-lg border border-stone-700/60 bg-stone-900/70 p-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
          placeholder="Search entries by title, URL, username…"
          disabled={busy}
          className="w-full pl-9 pr-3 py-2 bg-stone-800 border border-stone-600 rounded-md text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600/60"
        />
      </div>
      {query.trim().length < 2 ? (
        <p className="text-[11px] text-stone-500 mt-2 px-1">Type at least 2 characters to search.</p>
      ) : searching ? (
        <p className="text-[11px] text-stone-500 mt-2 px-1">Searching…</p>
      ) : results.length === 0 ? (
        <p className="text-[11px] text-stone-500 mt-2 px-1">No entries match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="mt-2 space-y-1 max-h-56 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                disabled={busy}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-800 text-sm text-stone-200 transition"
              >
                <span className="text-[10px] uppercase tracking-[0.16em] text-stone-500 w-12 shrink-0">{r.type}</span>
                <span className="truncate flex-1">{r.title}</span>
                <Check size={12} className="text-emerald-400 opacity-0 group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
