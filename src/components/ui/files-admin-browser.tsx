'use client'

// Admin-only file browser with bulk select, three reassign targets
// (category / different note / different entry), and per-file or bulk
// delete. Designed for cleaning up large imports — Lance's Bug Out
// Folder dumped ~600 files and most of the workflow is "select these
// 50, move them to that subcategory."

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Download, FileText, Image as ImageIcon, Film, File as FileIcon, Search,
  FolderInput, Trash2, X, Lock, Check, CheckSquare, Square,
} from 'lucide-react'
import { formatBytes } from '@/lib/format'
import {
  reassignFile, adminDeleteFile, bulkReassignFiles, bulkDeleteFiles,
  type ReassignTarget,
} from '@/lib/actions/admin'
import { FilePreviewButton, isPreviewable } from './file-preview'

export type FileKind = 'note' | 'entry' | 'category' | 'orphan'

export interface FileRow {
  id: string
  filename: string
  contentType: string
  size: number
  isPrivate: boolean
  uploadedAt: string
  uploaderName: string
  kind: FileKind
  parentTitle: string
  parentHref: string | null
  categoryId: string | null
  categoryName: string | null
  subcategoryId: string | null
  subcategoryName: string | null
  downloadHref: string
}

export interface CategoryOption { id: string; name: string }
export interface SubcategoryOption { id: string; name: string; categoryId: string }
export interface NoteOption {
  id: string
  title: string
  categoryName: string | null
  subcategoryName: string | null
}
export interface EntryOption {
  id: string
  title: string
  type: string
  categoryName: string | null
}

const TYPE_GROUPS: { value: 'all' | 'image' | 'video' | 'pdf' | 'doc' | 'other'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'doc', label: 'Docs' },
  { value: 'other', label: 'Other' },
]

function classify(contentType: string): 'image' | 'video' | 'pdf' | 'doc' | 'other' {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType === 'application/pdf') return 'pdf'
  if (contentType.includes('word') || contentType.includes('officedocument') || contentType === 'text/plain') return 'doc'
  return 'other'
}

function TypeIcon({ contentType, className }: { contentType: string; className?: string }) {
  const k = classify(contentType)
  if (k === 'image') return <ImageIcon size={16} className={className ?? 'text-blue-400'} />
  if (k === 'video') return <Film size={16} className={className ?? 'text-purple-400'} />
  if (k === 'pdf') return <FileText size={16} className={className ?? 'text-red-400'} />
  if (k === 'doc') return <FileText size={16} className={className ?? 'text-sky-400'} />
  return <FileIcon size={16} className={className ?? 'text-stone-400'} />
}

interface Props {
  rows: FileRow[]
  categories: CategoryOption[]
  subcategories: SubcategoryOption[]
  notes: NoteOption[]
  entries: EntryOption[]
}

export function FilesAdminBrowser({ rows, categories, subcategories, notes, entries }: Props) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<typeof TYPE_GROUPS[number]['value']>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reassigning, setReassigning] = useState<FileRow | null>(null)
  const [deleting, setDeleting] = useState<FileRow | null>(null)
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.filename.toLowerCase().includes(q) && !r.parentTitle.toLowerCase().includes(q)) return false
      if (typeFilter !== 'all' && classify(r.contentType) !== typeFilter) return false
      if (categoryFilter === 'orphan' && r.categoryId) return false
      if (categoryFilter !== 'all' && categoryFilter !== 'orphan' && r.categoryId !== categoryFilter) return false
      return true
    })
  }, [rows, query, typeFilter, categoryFilter])

  const totalSize = useMemo(() => filtered.reduce((acc, r) => acc + r.size, 0), [filtered])
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))
  const someFilteredSelected = filtered.some((r) => selectedIds.has(r.id))
  const selectedRows = filtered.filter((r) => selectedIds.has(r.id))
  const selectedSize = selectedRows.reduce((a, r) => a + r.size, 0)

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const r of filtered) next.delete(r.id)
      } else {
        for (const r of filtered) next.add(r.id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search filename or parent…"
            className="w-full pl-9 pr-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        >
          {TYPE_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        >
          <option value="all">All categories</option>
          <option value="orphan">— No category —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Counter + select-all */}
      <div className="flex items-center justify-between mb-3 text-xs text-stone-500">
        <span>
          {filtered.length} of {rows.length} file{rows.length === 1 ? '' : 's'} · {formatBytes(totalSize)}
        </span>
        {filtered.length > 0 && (
          <button
            type="button"
            onClick={toggleAllFiltered}
            className="inline-flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition"
          >
            {allFilteredSelected ? <CheckSquare size={13} className="text-emerald-400" /> : <Square size={13} />}
            {allFilteredSelected ? 'Deselect filtered' : `Select all ${filtered.length}`}
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-stone-800 rounded-xl">
          {rows.length === 0 ? 'No files in the vault yet.' : 'No files match the current filters.'}
        </div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-hidden mb-24">
          {filtered.map((row, idx) => {
            const checked = selectedIds.has(row.id)
            return (
              <div
                key={row.id}
                className={`flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-3 md:px-4 py-3 ${idx > 0 ? 'border-t border-stone-800' : ''} ${checked ? 'bg-sky-950/30' : 'hover:bg-stone-800/40'} transition`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => toggleOne(row.id)}
                    aria-label={checked ? 'Deselect' : 'Select'}
                    className="shrink-0"
                  >
                    {checked ? (
                      <CheckSquare size={16} className="text-sky-400" />
                    ) : (
                      <Square size={16} className="text-stone-600 hover:text-stone-400 transition" />
                    )}
                  </button>
                  <TypeIcon contentType={row.contentType} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-stone-100 font-medium">
                      <span className="truncate">{row.filename}</span>
                      {row.isPrivate && (
                        <span title="Private" className="shrink-0">
                          <Lock size={11} className="text-amber-400" aria-label="Private" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 truncate">
                      {row.kind === 'orphan' ? (
                        <span className="text-amber-400/80">Unattached</span>
                      ) : row.parentHref ? (
                        <Link href={row.parentHref} className="hover:text-stone-300 transition">
                          in <span className="text-stone-400">{row.parentTitle}</span>
                        </Link>
                      ) : (
                        <span>in {row.parentTitle}</span>
                      )}
                      {row.categoryName && (
                        <>
                          <span className="mx-1.5 text-stone-700">·</span>
                          <span>{row.categoryName}{row.subcategoryName ? ` › ${row.subcategoryName}` : ''}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:gap-3 shrink-0 ml-7 md:ml-0">
                  <span className="text-xs text-stone-500 w-16 text-right">{formatBytes(row.size)}</span>
                  {isPreviewable(row.contentType) && (
                    <FilePreviewButton
                      file={{ id: row.id, filename: row.filename, contentType: row.contentType, size: row.size }}
                    />
                  )}
                  <a
                    href={row.downloadHref}
                    title="Download"
                    className="p-1.5 rounded text-stone-500 hover:text-emerald-400 hover:bg-stone-700 transition"
                  >
                    <Download size={14} />
                  </a>
                  <button
                    type="button"
                    onClick={() => setReassigning(row)}
                    title="Reassign"
                    className="p-1.5 rounded text-stone-500 hover:text-sky-400 hover:bg-stone-700 transition"
                  >
                    <FolderInput size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(row)}
                    title="Delete file"
                    className="p-1.5 rounded text-stone-500 hover:text-red-400 hover:bg-stone-700 transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bulk action bar */}
      {someFilteredSelected && (
        <div className="fixed bottom-20 md:bottom-3 left-3 right-3 md:left-auto md:right-3 md:max-w-md z-40 flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-sky-700/50 bg-stone-900/95 backdrop-blur shadow-2xl">
          <CheckSquare size={16} className="text-sky-400 shrink-0" />
          <div className="flex-1 min-w-0 text-sm">
            <div className="text-stone-100 font-medium">{selectedIds.size} selected</div>
            <div className="text-xs text-stone-500">{formatBytes(selectedSize)}</div>
          </div>
          <button
            type="button"
            onClick={() => setBulkReassignOpen(true)}
            title="Reassign all"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-700 hover:bg-sky-600 text-white rounded-lg transition"
          >
            <FolderInput size={13} />
            Move
          </button>
          <button
            type="button"
            onClick={() => setBulkDeleteOpen(true)}
            title="Delete all"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-red-900/40 text-stone-300 hover:text-red-300 border border-stone-700 hover:border-red-800/50 rounded-lg transition"
          >
            <Trash2 size={13} />
            Delete
          </button>
          <button
            type="button"
            onClick={clearSelection}
            title="Clear selection"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {reassigning && (
        <ReassignModal
          rows={[reassigning]}
          categories={categories}
          subcategories={subcategories}
          notes={notes}
          entries={entries}
          onClose={() => setReassigning(null)}
          onDone={() => { setReassigning(null) }}
        />
      )}

      {bulkReassignOpen && (
        <ReassignModal
          rows={selectedRows}
          categories={categories}
          subcategories={subcategories}
          notes={notes}
          entries={entries}
          onClose={() => setBulkReassignOpen(false)}
          onDone={() => { setBulkReassignOpen(false); clearSelection() }}
        />
      )}

      {deleting && (
        <DeleteModal
          rows={[deleting]}
          onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null) }}
        />
      )}

      {bulkDeleteOpen && (
        <DeleteModal
          rows={selectedRows}
          onClose={() => setBulkDeleteOpen(false)}
          onDone={() => { setBulkDeleteOpen(false); clearSelection() }}
        />
      )}
    </>
  )
}

// ─── Reassign modal (single OR bulk) ──────────────────────────────────────────

type ReassignTab = 'category' | 'note' | 'entry'

interface ReassignModalProps {
  rows: FileRow[]
  categories: CategoryOption[]
  subcategories: SubcategoryOption[]
  notes: NoteOption[]
  entries: EntryOption[]
  onClose: () => void
  onDone: () => void
}

function ReassignModal({ rows, categories, subcategories, notes, entries, onClose, onDone }: ReassignModalProps) {
  const router = useRouter()
  const single = rows.length === 1 ? rows[0] : null
  const bulk = rows.length > 1

  const [tab, setTab] = useState<ReassignTab>('category')

  // Category tab
  const [categoryId, setCategoryId] = useState<string>(single?.categoryId ?? '')
  const [subcategoryId, setSubcategoryId] = useState<string>(single?.subcategoryId ?? '')
  const subsForCat = useMemo(
    () => (categoryId ? subcategories.filter((s) => s.categoryId === categoryId) : []),
    [categoryId, subcategories]
  )

  // Note + entry tabs share a query
  const [noteQuery, setNoteQuery] = useState('')
  const [pickedNoteId, setPickedNoteId] = useState<string>('')
  const [entryQuery, setEntryQuery] = useState('')
  const [pickedEntryId, setPickedEntryId] = useState<string>('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  function handleCategoryChange(next: string) {
    setCategoryId(next)
    const stillValid = subcategories.find((s) => s.id === subcategoryId && s.categoryId === next)
    if (!stillValid) setSubcategoryId('')
  }

  const filteredNotes = useMemo(() => {
    const q = noteQuery.trim().toLowerCase()
    if (!q) return notes.slice(0, 50)
    return notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 50)
  }, [notes, noteQuery])

  const filteredEntries = useMemo(() => {
    const q = entryQuery.trim().toLowerCase()
    if (!q) return entries.slice(0, 50)
    return entries.filter((e) => e.title.toLowerCase().includes(q)).slice(0, 50)
  }, [entries, entryQuery])

  function buildTarget(): ReassignTarget | null {
    if (tab === 'category') {
      if (!categoryId) { setError('Pick a category.'); return null }
      return { kind: 'category', categoryId, subcategoryId: subcategoryId || null }
    }
    if (tab === 'note') {
      if (!pickedNoteId) { setError('Pick a note.'); return null }
      return { kind: 'note', noteId: pickedNoteId }
    }
    if (!pickedEntryId) { setError('Pick an entry.'); return null }
    return { kind: 'entry', entryId: pickedEntryId }
  }

  async function save() {
    setError(null)
    const target = buildTarget()
    if (!target) return

    setBusy(true)
    if (bulk) {
      setProgress(`Moving ${rows.length} files…`)
      const res = await bulkReassignFiles(rows.map((r) => r.id), target)
      setBusy(false)
      setProgress(null)
      if (res?.error) { setError(res.error); return }
      if (res?.failed && res.failed > 0) {
        setError(`Moved ${res.ok}, ${res.failed} failed.`)
        // still refresh + close — the success cases shouldn't be undone
      }
      router.refresh()
      onDone()
      return
    }

    // Single
    const res = await reassignFile(rows[0].id, target)
    setBusy(false)
    if ('error' in res && res.error) { setError(res.error); return }
    router.refresh()
    onDone()
  }

  const titleText = bulk
    ? `Move ${rows.length} files`
    : `Move "${rows[0]?.filename ?? 'file'}"`

  // Help text varies by current tab and (for single) the file's current parent.
  const helpText = (() => {
    if (bulk) {
      if (tab === 'category') return 'Files attached to a note or entry will move via their parent (note travels with the file). Bare files attach directly to the chosen category.'
      if (tab === 'note') return 'Each selected file will detach from its current parent and re-attach to the chosen note.'
      return 'Each selected file will detach from its current parent and re-attach to the chosen entry.'
    }
    if (!single) return ''
    if (tab === 'category') {
      if (single.kind === 'note') return `Moves the parent note "${single.parentTitle}" (and this file) to the chosen category.`
      if (single.kind === 'entry') return `Moves the parent entry "${single.parentTitle}" (and this file) to the chosen category.`
      return 'Attaches this file directly to the chosen category. Subcategory is ignored for bare-on-category files.'
    }
    if (tab === 'note') return 'Detaches the file from its current parent and attaches it to the chosen note.'
    return 'Detaches the file from its current parent and attaches it to the chosen entry.'
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100 truncate">
            <FolderInput size={15} className="text-sky-400 shrink-0" />
            <span className="truncate">{titleText}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-50 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-800 bg-stone-900/50 shrink-0">
          {(['category', 'note', 'entry'] as ReassignTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setError(null) }}
              disabled={busy}
              className={`flex-1 px-3 py-2 text-xs font-medium uppercase tracking-wider transition ${
                tab === t
                  ? 'text-sky-300 border-b-2 border-sky-500'
                  : 'text-stone-500 hover:text-stone-300 border-b-2 border-transparent'
              }`}
            >
              {t === 'category' ? 'Category' : t === 'note' ? 'Different note' : 'Different entry'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-stone-500">{helpText}</p>

          {tab === 'category' && (
            <>
              <div>
                <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  disabled={busy}
                  className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
                >
                  <option value="">— Pick one —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {subsForCat.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                    Subcategory <span className="text-stone-600">(optional)</span>
                  </label>
                  <select
                    value={subcategoryId}
                    onChange={(e) => setSubcategoryId(e.target.value)}
                    disabled={busy}
                    className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
                  >
                    <option value="">None</option>
                    {subsForCat.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {tab === 'note' && (
            <NotePicker
              query={noteQuery}
              onQueryChange={setNoteQuery}
              filtered={filteredNotes}
              total={notes.length}
              pickedId={pickedNoteId}
              onPick={setPickedNoteId}
              busy={busy}
            />
          )}

          {tab === 'entry' && (
            <EntryPicker
              query={entryQuery}
              onQueryChange={setEntryQuery}
              filtered={filteredEntries}
              total={entries.length}
              pickedId={pickedEntryId}
              onPick={setPickedEntryId}
              busy={busy}
            />
          )}

          {progress && <p className="text-sm text-sky-300">{progress}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-800 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || (tab === 'category' && !categoryId) || (tab === 'note' && !pickedNoteId) || (tab === 'entry' && !pickedEntryId)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-sky-700 hover:bg-sky-600 disabled:bg-sky-900 disabled:opacity-60 text-white rounded-lg transition"
          >
            {busy ? (
              <>
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                Moving…
              </>
            ) : bulk ? `Move ${rows.length} files` : 'Move'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Searchable picker for notes ──────────────────────────────────────────────

interface NotePickerProps {
  query: string
  onQueryChange: (s: string) => void
  filtered: NoteOption[]
  total: number
  pickedId: string
  onPick: (id: string) => void
  busy: boolean
}

function NotePicker({ query, onQueryChange, filtered, total, pickedId, onPick, busy }: NotePickerProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
        Search notes
      </label>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          disabled={busy}
          placeholder={`Type to filter ${total} notes…`}
          className="w-full pl-9 pr-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div className="rounded-lg border border-stone-800 max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-stone-500 py-6">No matches.</p>
        ) : (
          filtered.map((n) => {
            const picked = pickedId === n.id
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onPick(n.id)}
                disabled={busy}
                className={`w-full text-left px-3 py-2 border-b border-stone-800/60 last:border-0 transition ${picked ? 'bg-sky-950/40' : 'hover:bg-stone-800'} disabled:opacity-50`}
              >
                <div className="flex items-center gap-2 text-sm text-stone-200">
                  {picked && <Check size={13} className="text-sky-400 shrink-0" />}
                  <span className="truncate flex-1">{n.title}</span>
                </div>
                {(n.categoryName || n.subcategoryName) && (
                  <div className="text-[11px] text-stone-500 mt-0.5 truncate ml-5">
                    {[n.categoryName, n.subcategoryName].filter(Boolean).join(' › ')}
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
      {filtered.length === 50 && (
        <p className="mt-1 text-[11px] text-stone-600">Showing first 50. Refine the search to see more.</p>
      )}
    </div>
  )
}

// ─── Searchable picker for entries ────────────────────────────────────────────

interface EntryPickerProps {
  query: string
  onQueryChange: (s: string) => void
  filtered: EntryOption[]
  total: number
  pickedId: string
  onPick: (id: string) => void
  busy: boolean
}

function EntryPicker({ query, onQueryChange, filtered, total, pickedId, onPick, busy }: EntryPickerProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
        Search entries
      </label>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          disabled={busy}
          placeholder={`Type to filter ${total} entries…`}
          className="w-full pl-9 pr-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div className="rounded-lg border border-stone-800 max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-stone-500 py-6">No matches.</p>
        ) : (
          filtered.map((e) => {
            const picked = pickedId === e.id
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e.id)}
                disabled={busy}
                className={`w-full text-left px-3 py-2 border-b border-stone-800/60 last:border-0 transition ${picked ? 'bg-sky-950/40' : 'hover:bg-stone-800'} disabled:opacity-50`}
              >
                <div className="flex items-center gap-2 text-sm text-stone-200">
                  {picked && <Check size={13} className="text-sky-400 shrink-0" />}
                  <span className="truncate flex-1">{e.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 shrink-0">{e.type.replace('_', ' ')}</span>
                </div>
                {e.categoryName && (
                  <div className="text-[11px] text-stone-500 mt-0.5 truncate ml-5">{e.categoryName}</div>
                )}
              </button>
            )
          })
        )}
      </div>
      {filtered.length === 50 && (
        <p className="mt-1 text-[11px] text-stone-600">Showing first 50. Refine the search to see more.</p>
      )}
    </div>
  )
}

// ─── Delete modal (single OR bulk) ────────────────────────────────────────────

interface DeleteModalProps {
  rows: FileRow[]
  onClose: () => void
  onDone: () => void
}

function DeleteModal({ rows, onClose, onDone }: DeleteModalProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bulk = rows.length > 1
  const totalSize = rows.reduce((a, r) => a + r.size, 0)

  async function confirm() {
    setBusy(true)
    setError(null)
    if (bulk) {
      const res = await bulkDeleteFiles(rows.map((r) => r.id))
      setBusy(false)
      if (res?.error) { setError(res.error); return }
      if (res?.failed && res.failed > 0) {
        setError(`Deleted ${res.ok}, ${res.failed} failed.`)
      }
      router.refresh()
      onDone()
      return
    }
    const res = await adminDeleteFile(rows[0].id)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
    onDone()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100">
            <Trash2 size={15} className="text-red-400" />
            {bulk ? `Delete ${rows.length} files?` : 'Delete file?'}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          {bulk ? (
            <p className="text-sm text-stone-300">
              {rows.length} files · {formatBytes(totalSize)} total. Removes the
              files from the vault and their blobs from storage.
            </p>
          ) : (
            <p className="text-sm text-stone-300 truncate" title={rows[0].filename}>{rows[0].filename}</p>
          )}
          <p className="text-xs text-stone-500">
            Parent {bulk ? 'attachments stay' : rows[0].kind === 'orphan' ? 'attachment stays' : `${rows[0].kind} stays`}.
            This cannot be undone.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 disabled:bg-red-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {busy ? 'Deleting…' : bulk ? `Delete ${rows.length}` : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
