'use client'

// Client island for /locate (v257). Owns:
//   • The flat row list, grouped client-side by areaId
//   • A single search box that filters across every row
//   • Per-row state machine: view / editing / new draft
//   • Inline "+ New area" affordance at the page bottom
//   • Photo attach flow: file picker → crop/zoom overlay → canvas →
//     upload via the existing /api/files pipeline
//
// All mutations go through thin server actions in actions/entries.ts.
// We optimistically reflect the change in local state and call
// router.refresh() to re-pull the server view once the server confirms.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, Plus, Check, ImagePlus, Trash2, Lock, Unlock } from 'lucide-react'
import {
  createLocateNote,
  updateLocateNote,
  deleteLocateNote,
  setLocateNotePrivate,
  createWhereIsItArea,
} from '@/lib/actions/entries'
import { uploadFile } from '@/lib/actions/files'
import { PhotoCropUploader } from './photo-crop-uploader'

export interface AreaShape {
  id: string
  slug: string
  name: string
  sortOrder: number
}

export interface LocateRowShape {
  id: string
  areaId: string
  title: string
  content: string
  photoFileId: string | null
  photoCount: number
  ownerName: string | null
  isPrivate: boolean
}

// Per-area visual tone. Built from the four CobbVault icon-set cores
// (Gold / Maroon / Navy / Forest Green) plus their -lite variants — same
// palette as the rest of the app, no off-palette accents. Values are raw
// CSS colors so the rgb(... / 0.NN) opacity composes cleanly with the
// vault hexes (Tailwind arbitrary classes don't let opacity hop onto an
// arb color without per-utility helpers). JSX consumes via inline style
// instead of className interpolation. Emoji column dropped per Lance —
// he flagged them as "dumblooking icons in front of the main areas".
type AreaTone = { headerBg: string; bodyBg: string; border: string; text: string }
const AREA_TONE: Record<string, AreaTone> = {
  // Cabin — Gold (the marigold; matches the icon-set core)
  cabin:    { headerBg: 'rgb(209 138 22 / 0.92)', bodyBg: 'rgb(209 138 22 / 0.10)', border: 'rgb(231 178 74 / 0.50)', text: '#FFE0A1' },
  // Home — Maroon
  home:     { headerBg: 'rgb(143 32 23 / 0.92)',  bodyBg: 'rgb(143 32 23 / 0.10)',  border: 'rgb(179 58 48 / 0.50)',  text: '#F5BFB7' },
  // Garage — Navy
  garage:   { headerBg: 'rgb(24 72 111 / 0.92)',  bodyBg: 'rgb(24 72 111 / 0.12)',  border: 'rgb(62 129 181 / 0.50)', text: '#B6D5EA' },
  // Office — Navy-lite (distinct from Garage without leaving palette)
  office:   { headerBg: 'rgb(62 129 181 / 0.85)', bodyBg: 'rgb(62 129 181 / 0.10)', border: 'rgb(62 129 181 / 0.55)', text: '#D4E5F1' },
  // Basement — Forest Green
  basement: { headerBg: 'rgb(62 108 47 / 0.92)',  bodyBg: 'rgb(62 108 47 / 0.12)',  border: 'rgb(94 149 75 / 0.50)',  text: '#C2DDB4' },
  // Storage — Green-lite (distinct from Basement without leaving palette)
  storage:  { headerBg: 'rgb(94 149 75 / 0.85)',  bodyBg: 'rgb(94 149 75 / 0.10)',  border: 'rgb(94 149 75 / 0.55)',  text: '#D6E8C8' },
  // Safe — near-black stone (neutral, not a vault hue)
  safe:     { headerBg: 'rgb(41 37 36 / 1)',       bodyBg: 'rgb(28 25 23 / 0.40)',   border: 'rgb(120 113 108 / 0.50)', text: '#e7e5e4' },
}
const FALLBACK_TONE: AreaTone = {
  headerBg: 'rgb(68 64 60 / 1)',
  bodyBg: 'rgb(28 25 23 / 0.40)',
  border: 'rgb(120 113 108 / 0.50)',
  text: '#e7e5e4',
}

function toneFor(slug: string): AreaTone {
  return AREA_TONE[slug] ?? FALLBACK_TONE
}

export function LocateClient({
  areas,
  rows,
  canEdit,
  isSuperuser,
}: {
  areas: AreaShape[]
  rows: LocateRowShape[]
  canEdit: boolean
  isSuperuser: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')

  // Draft rows are kept here so the UI can open one per section. Maps
  // areaId → a draft instance with its own ephemeral input state.
  const [drafts, setDrafts] = useState<Record<string, boolean>>({})

  // Search results — title + content match, case-insensitive.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.title.toLowerCase().includes(q) || (r.content ?? '').toLowerCase().includes(q),
    )
  }, [rows, query])

  // Index rows by areaId once so each section render is O(its own size).
  const rowsByArea = useMemo(() => {
    const m = new Map<string, LocateRowShape[]>()
    for (const r of filtered) {
      const cur = m.get(r.areaId)
      if (cur) cur.push(r)
      else m.set(r.areaId, [r])
    }
    return m
  }, [filtered])

  const totalCount = rows.length
  const showingCount = filtered.length

  function openDraft(areaId: string) {
    setDrafts((d) => ({ ...d, [areaId]: true }))
  }
  function closeDraft(areaId: string) {
    setDrafts((d) => {
      const next = { ...d }
      delete next[areaId]
      return next
    })
  }

  function onSaved() {
    router.refresh()
  }

  return (
    <>
      <SearchBar
        query={query}
        setQuery={setQuery}
        totalCount={totalCount}
        showingCount={showingCount}
      />

      <div className="space-y-4">
        {areas.map((area) => {
          const areaRows = rowsByArea.get(area.id) ?? []
          // During an active search we hide empty sections so the page
          // doesn't show 6 empty headers when only Cabin has a match.
          if (query.trim() && areaRows.length === 0 && !drafts[area.id]) return null
          const tone = toneFor(area.slug)
          return (
            <Section
              key={area.id}
              area={area}
              tone={tone}
              rows={areaRows}
              draftOpen={!!drafts[area.id]}
              onOpenDraft={() => openDraft(area.id)}
              onCloseDraft={() => closeDraft(area.id)}
              canEdit={canEdit}
              isSuperuser={isSuperuser}
              searching={!!query.trim()}
              onSaved={onSaved}
            />
          )
        })}
      </div>

      {/* Empty state — the whole page is empty (no rows in any area at
          all). Only shows when not searching. */}
      {!query.trim() && rows.length === 0 && (
        <div className="mt-2 rounded-2xl border border-stone-700/50 bg-stone-900/40 p-8 text-center">
          <p className="text-sm text-stone-400 leading-relaxed">
            Nothing here yet. Tap <strong>+</strong> on any section above to drop in the first treasure —
            that thing nobody else can ever find.
          </p>
        </div>
      )}

      {/* No-search-match state */}
      {query.trim() && showingCount === 0 && (
        <div className="mt-2 rounded-2xl border border-stone-700/50 bg-stone-900/40 p-6 text-center">
          <p className="text-sm text-stone-400">No matches for &ldquo;{query}&rdquo;.</p>
        </div>
      )}

      {canEdit && <NewAreaForm onCreated={onSaved} />}
    </>
  )
}

// ─── Search bar ─────────────────────────────────────────────────────────────

function SearchBar({
  query,
  setQuery,
  totalCount,
  showingCount,
}: {
  query: string
  setQuery: (q: string) => void
  totalCount: number
  showingCount: number
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every area — item or location"
          className="w-full pl-9 pr-9 py-2 bg-stone-900/50 border border-stone-700 rounded-lg text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 p-1"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <span className="text-xs font-mono text-stone-500 shrink-0">
        {query ? `${showingCount}/${totalCount}` : totalCount}
      </span>
    </div>
  )
}

// ─── One area section (header + rows + optional draft row) ────────────────

function Section({
  area,
  tone,
  rows,
  draftOpen,
  onOpenDraft,
  onCloseDraft,
  canEdit,
  isSuperuser,
  searching,
  onSaved,
}: {
  area: AreaShape
  tone: AreaTone
  rows: LocateRowShape[]
  draftOpen: boolean
  onOpenDraft: () => void
  onCloseDraft: () => void
  canEdit: boolean
  isSuperuser: boolean
  searching: boolean
  onSaved: () => void
}) {
  return (
    <section
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: tone.border, background: tone.bodyBg }}
    >
      <header
        className="flex items-center justify-between gap-3 px-3 md:px-4 py-2 border-b"
        style={{ background: tone.headerBg, borderBottomColor: tone.border }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm md:text-base font-semibold truncate" style={{ color: tone.text }}>{area.name}</h2>
          <span className="text-[10px] font-mono text-white/80 shrink-0">{rows.length}</span>
        </div>
        {/* Hide the + while searching so the user doesn't accidentally
            add a row into a section that's only partially visible. */}
        {canEdit && !searching && (
          <button
            type="button"
            onClick={onOpenDraft}
            aria-label={`Add a row to ${area.name}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-stone-50 bg-black/30 hover:bg-black/50 border border-white/30 rounded-md px-2 py-1 transition"
          >
            <Plus size={12} />
            Add
          </button>
        )}
      </header>

      <div className="divide-y divide-stone-800/60">
        {rows.map((row) => (
          <Row key={row.id} row={row} canEdit={canEdit} isSuperuser={isSuperuser} onSaved={onSaved} />
        ))}
        {draftOpen && (
          <DraftRow
            areaId={area.id}
            onSaved={() => { onCloseDraft(); onSaved() }}
            onCancel={onCloseDraft}
          />
        )}
        {rows.length === 0 && !draftOpen && (
          <p className="px-3 md:px-4 py-2 text-xs text-stone-500 italic">
            {searching ? '— no matches in this area —' : 'Tap + to add the first thing in here.'}
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Live (existing) row ────────────────────────────────────────────────────

function Row({
  row,
  canEdit,
  isSuperuser,
  onSaved,
}: {
  row: LocateRowShape
  canEdit: boolean
  isSuperuser: boolean
  onSaved: () => void
}) {
  const router = useRouter()
  // Tri-state: null = view mode; 'title' / 'content' = editing with focus
  // on that field. Lance flagged that clicking the description didn't
  // edit it — the bug was a boolean `editing` flag with autoFocus pinned
  // to the title input, so a content click switched into edit mode but
  // stole focus to the title. Tracking which field was clicked routes
  // focus to the right control.
  const [editingFocus, setEditingFocus] = useState<null | 'title' | 'content'>(null)
  const editing = editingFocus !== null
  function startEdit(focus: 'title' | 'content') {
    setEditingFocus(focus)
  }
  function exitEdit() {
    setEditingFocus(null)
  }
  const [title, setTitle] = useState(row.title)
  const [content, setContent] = useState(row.content)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cancelledRef = useRef(false)

  // Sync local state when the server view changes (after refresh).
  useEffect(() => { setTitle(row.title); setContent(row.content) }, [row.title, row.content])

  async function commit() {
    if (cancelledRef.current) { cancelledRef.current = false; return }
    const t = title.trim()
    const c = content
    if (!t) {
      // Empty title isn't valid — bounce back into view mode with the
      // old values so the user doesn't accidentally blank the row.
      setTitle(row.title)
      exitEdit()
      return
    }
    if (t === row.title && c === row.content) {
      exitEdit()
      return
    }
    setBusy(true)
    const res = await updateLocateNote(row.id, { title: t, content: c })
    setBusy(false)
    exitEdit()
    if ('error' in res && res.error) return
    startTransition(() => router.refresh())
    onSaved()
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true)
    await deleteLocateNote(row.id)
    setBusy(false)
    startTransition(() => router.refresh())
    onSaved()
  }

  function onPhotoUploaded() {
    setPickerOpen(false)
    startTransition(() => router.refresh())
    onSaved()
  }

  async function togglePrivate() {
    setBusy(true)
    const next = !row.isPrivate
    await setLocateNotePrivate(row.id, next)
    setBusy(false)
    startTransition(() => router.refresh())
    onSaved()
  }

  // Per-row action cluster — photo affordance + privacy lock + delete.
  // Extracted so it can render on the top row (level with the title) on
  // both mobile and desktop instead of being trapped in a third column
  // that mobile stacked beneath the content. Lock toggle is superuser-
  // only since non-superusers can't see private rows anyway.
  const actions = (
    <div className="flex items-center gap-2 shrink-0">
      {row.photoFileId ? (
        <a
          href={`/api/files/${row.photoFileId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 transition"
          title={row.photoCount > 1 ? `${row.photoCount} photos attached — opens the latest` : 'Open photo'}
        >
          📎 View
        </a>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-emerald-300 transition"
        >
          <ImagePlus size={11} />
          photo
        </button>
      ) : null}
      {isSuperuser && (
        <button
          type="button"
          onClick={togglePrivate}
          disabled={busy}
          aria-label={row.isPrivate ? 'Mark visible to family' : 'Hide from family'}
          className={`p-1 rounded transition ${
            row.isPrivate
              ? 'text-amber-400 hover:text-amber-300 hover:bg-stone-800/60'
              : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/60'
          }`}
          title={row.isPrivate ? 'Private — hidden from family. Click to share.' : 'Visible to family. Click to hide.'}
        >
          {row.isPrivate ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          aria-label={confirmDelete ? 'Click again to delete' : 'Delete row'}
          className={`p-1 rounded transition ${
            confirmDelete
              ? 'bg-red-900/40 text-red-300 ring-1 ring-red-700/60'
              : 'text-stone-500 hover:text-red-400 hover:bg-stone-800/60'
          }`}
          title={confirmDelete ? 'Click again to confirm' : 'Delete'}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )

  return (
    <div className="px-3 md:px-4 py-2 hover:bg-stone-900/40 transition">
      {/* Top row: entry title + actions on the right, same line. Lance
          wanted "add photo and delete icons to the right side on level
          with the entry title" — previously the actions sat in their own
          third flex column which stacked below the content on mobile. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing && canEdit ? (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur() }
                else if (e.key === 'Escape') { cancelledRef.current = true; setTitle(row.title); setContent(row.content); exitEdit() }
              }}
              autoFocus={editingFocus === 'title'}
              disabled={busy}
              className="w-full bg-stone-900/60 border border-stone-600 rounded px-2 py-1 text-sm font-medium text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-600/60"
            />
          ) : (
            <button
              type="button"
              onClick={() => canEdit && startEdit('title')}
              disabled={!canEdit}
              className={`block w-full text-left text-sm font-semibold leading-snug ${
                row.isPrivate ? 'text-stone-400' : 'text-stone-100'
              } ${canEdit ? 'cursor-text hover:text-emerald-200' : ''}`}
            >
              {row.title}
            </button>
          )}
        </div>
        {actions}
      </div>
      {/* Content row below — gets the full row width on every breakpoint
          so a long-location description has room to wrap without
          jostling the action cluster. */}
      <div className="mt-1">
        {editing && canEdit ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              // Plain Enter saves (newlines are rare for location prose);
              // Shift+Enter inserts a newline if you really need one.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.currentTarget as HTMLTextAreaElement).blur()
              } else if (e.key === 'Escape') {
                cancelledRef.current = true
                setTitle(row.title)
                setContent(row.content)
                exitEdit()
              }
            }}
            autoFocus={editingFocus === 'content'}
            rows={2}
            disabled={busy}
            className="w-full bg-stone-900/60 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-600/60 resize-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => canEdit && startEdit('content')}
            disabled={!canEdit}
            className={`block w-full text-left text-sm leading-snug whitespace-pre-wrap ${
              row.isPrivate ? 'text-stone-500' : 'text-stone-300'
            } ${canEdit ? 'cursor-text hover:text-stone-100' : ''}`}
          >
            {row.content || <span className="italic text-stone-500">No location yet — click to add</span>}
          </button>
        )}
      </div>
      {pickerOpen && canEdit && (
        <PhotoCropUploader
          noteId={row.id}
          onClose={() => setPickerOpen(false)}
          onUploaded={onPhotoUploaded}
        />
      )}
    </div>
  )
}

// ─── New draft row (under a section after tapping +) ───────────────────────

function DraftRow({
  areaId,
  onSaved,
  onCancel,
}: {
  areaId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null)
  const [wantPhoto, setWantPhoto] = useState(false)
  const [, startTransition] = useTransition()
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  // Track which fields the user has already touched so an immediate
  // tab-then-click doesn't fire a save with no title.
  const draftIsEmpty = !title.trim() && !content.trim()

  async function commit() {
    const t = title.trim()
    if (!t) {
      if (draftIsEmpty) {
        // Truly empty — silently kill the draft, no error UI needed.
        onCancel()
        return
      }
      // Partial state (location typed but no title) — keep the draft
      // open so the user doesn't lose what they wrote.
      titleRef.current?.focus()
      return
    }
    setBusy(true)
    const res = await createLocateNote({ areaId, title: t, content })
    setBusy(false)
    if ('error' in res && res.error) return
    if (res.success && res.id) {
      setSavedNoteId(res.id)
      if (!wantPhoto) {
        // No photo wanted — done. Refresh + close the draft.
        startTransition(() => router.refresh())
        onSaved()
      }
      // If photo is wanted, leave the draft on screen with the photo
      // picker open so the user can attach right away.
    }
  }

  function onPhotoUploaded() {
    startTransition(() => router.refresh())
    onSaved()
  }

  // Wire onBlur on the *container* — bouncing focus between the title
  // and content inputs shouldn't fire commit, but leaving the row
  // entirely should. Use a relatedTarget check to disambiguate.
  function onContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    if (!savedNoteId) void commit()
  }

  return (
    <div
      className="px-3 md:px-4 py-2 bg-stone-900/40 border-l-2 border-stone-600/50"
      onBlur={onContainerBlur}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:gap-4">
        <div className="sm:w-1/3 sm:shrink-0">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur() }
              else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
            }}
            placeholder="Item (e.g. Snowblower key)"
            disabled={busy || !!savedNoteId}
            className="w-full bg-stone-900/60 border border-stone-600 rounded px-2 py-1 text-sm font-medium text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-600/60"
          />
        </div>
        <div className="flex-1 mt-1 sm:mt-0 min-w-0">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.currentTarget as HTMLTextAreaElement).blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
            placeholder="Where it lives (e.g. Hook by the back door)"
            rows={2}
            disabled={busy || !!savedNoteId}
            className="w-full bg-stone-900/60 border border-stone-600 rounded px-2 py-1 text-sm text-stone-200 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-600/60 resize-none"
          />
        </div>
        <div className="flex items-center gap-2 mt-1 sm:mt-0 sm:shrink-0">
          <label className="inline-flex items-center gap-1 text-[11px] text-stone-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={wantPhoto}
              onChange={(e) => setWantPhoto(e.target.checked)}
              className="accent-emerald-500"
            />
            photo
          </label>
          <button
            type="button"
            onClick={commit}
            disabled={busy || !title.trim()}
            aria-label="Save row"
            className="p-1 rounded text-emerald-300 hover:text-emerald-200 hover:bg-stone-800/60 disabled:opacity-40 transition"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel"
            className="p-1 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-800/60 transition"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* If the user ticked photo, open the crop uploader as soon as the
          row is saved so we have a noteId to attach the file to. */}
      {savedNoteId && wantPhoto && (
        <PhotoCropUploader
          noteId={savedNoteId}
          onClose={() => { onSaved() }}
          onUploaded={onPhotoUploaded}
        />
      )}
    </div>
  )
}

// ─── + New area (bottom of page) ────────────────────────────────────────────

function NewAreaForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) { setOpen(false); return }
    setBusy(true)
    setError(null)
    const res = await createWhereIsItArea(trimmed)
    setBusy(false)
    if ('error' in res && res.error) { setError(res.error); return }
    setName('')
    setOpen(false)
    startTransition(() => router.refresh())
    onCreated()
  }

  if (!open) {
    return (
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-emerald-300 bg-stone-900/40 hover:bg-stone-800/60 border border-stone-700/50 hover:border-emerald-700/50 rounded-full px-3 py-1.5 transition"
        >
          <Plus size={12} />
          New area (Lake Boat, RV, In-laws&hellip;)
        </button>
      </div>
    )
  }

  return (
    <div className="mt-5 flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit() }
          else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setName('') }
        }}
        placeholder="New area name"
        disabled={busy}
        className="flex-1 bg-stone-900/60 border border-stone-600 rounded-lg px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-600/60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim()}
        className="inline-flex items-center gap-1 px-3 py-2 bg-emerald-700/40 hover:bg-emerald-600/50 disabled:bg-emerald-900/40 disabled:opacity-50 text-emerald-100 text-sm font-medium rounded-lg transition"
      >
        <Check size={14} />
        Add
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(''); setError(null) }}
        className="px-3 py-2 text-sm text-stone-400 hover:text-stone-200 transition"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

// uploadFile is imported above so consumers (PhotoCropUploader) can keep
// their props small — it always lands on /api/files via the same path
// the rest of the vault uses.
export const uploadFileAction = uploadFile
