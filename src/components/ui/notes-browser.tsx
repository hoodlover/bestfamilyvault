'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { NoteCard } from './note-card'
import { HelpPopout } from './help-popout'
import type { InferSelectModel } from 'drizzle-orm'
import type { notes } from '@/lib/db/schema'

type Note = InferSelectModel<typeof notes>

interface CategoryInfo {
  /** Stable slug for picking a pill color. */
  slug: string
  /** Display label rendered inside the pill. */
  label: string
}

export function NotesBrowser({
  notes: allNotes,
  categoriesById,
  attachmentCounts,
}: {
  notes: Note[]
  /** Optional map id→{slug,label}. When provided, every note card surfaces a
   *  colored category pill in its footer (per the mobile redesign spec).
   *  Optional so existing call sites that haven't been threaded through
   *  yet keep working without a pill. */
  categoriesById?: Record<string, CategoryInfo>
  /** Per-note attachment counts keyed by note id. Drives the paperclip
   *  chip on each NoteCard. Plain Record (not Map) so it serialises
   *  through the server→client boundary. Optional — undefined → no
   *  chips rendered. */
  attachmentCounts?: Record<string, number>
}) {
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showSearch) inputRef.current?.focus()
  }, [showSearch])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allNotes
    return allNotes.filter((n) => {
      const title = (n.title ?? '').toLowerCase()
      const content = (n.content ?? '').toLowerCase()
      return title.includes(q) || content.includes(q)
    })
  }, [allNotes, query])

  function closeSearch() {
    setQuery('')
    setShowSearch(false)
  }

  return (
    <>
      {/* ────────────────── Mobile redesign (md:hidden) ──────────────────
          Tight header: title + mono count + 40px add_note icon. Pill
          search lives below and is always visible (no toggle), matching
          the spec's "Pill search filters live." Desktop keeps the larger
          icon-driven header with the explicit search toggle. */}
      <div className="md:hidden mb-5">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Notes</h1>
          <span className="text-xs font-mono text-stone-500">
            {query ? `${filtered.length}/${allNotes.length}` : allNotes.length}
          </span>
          <Link
            href="/notes/new"
            aria-label="New Note"
            className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/addnote.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
          </Link>
        </div>
        <div className="flex items-center gap-2 px-4 rounded-full bg-stone-900/60 border border-stone-700/40 focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/20 transition">
          <Search size={16} className="text-stone-500 shrink-0" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="flex-1 min-w-0 bg-transparent py-2.5 text-base text-stone-100 placeholder:text-stone-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="p-1 -mr-2 rounded text-stone-500 hover:text-stone-200 transition shrink-0"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ────────────────── Desktop header (hidden on mobile) ───────────── */}
      <div className="hidden md:flex items-center justify-between gap-3 mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-stone-100 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/cobb/icons/system/notes2.png" width={72} height={72} alt="" className="object-contain rounded" />
            Notes
            <HelpPopout
              title="Notes"
              sections={[
                {
                  heading: 'What\'s here',
                  tips: [
                    { title: 'All notes', description: 'Free-form notes from across categories. Recipes have their own page (/recipes) and don\'t double up here.' },
                    { title: 'Per-user favorites', description: 'Star a note to bookmark it. Each family member\'s star list is independent.' },
                  ],
                },
                {
                  heading: 'Find + filter',
                  tips: [
                    { title: 'Search', description: 'Top input filters live by title + content. Cleared shows recents.' },
                    { title: 'Card pills', description: 'Recipe-type abbrev pills (SLO, MEA, DES…) on cards when applicable.' },
                  ],
                },
                {
                  heading: 'Create',
                  tips: [
                    { title: 'New note', description: 'Rich-text editor with bold, lists, links, checkboxes. Pick a category and (optionally) a subcategory.' },
                    { title: 'Attach files', description: 'After save, drop files on the note — auto-named from the title + capture date.' },
                  ],
                },
              ]}
            />
          </h1>
          <p className="text-stone-400 text-sm mt-0.5">
            {query
              ? `${filtered.length} of ${allNotes.length} match${filtered.length === 1 ? 'es' : 'es'}`
              : `${allNotes.length} note${allNotes.length !== 1 ? 's' : ''} in the vault.`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => (showSearch ? closeSearch() : setShowSearch(true))}
            aria-label={showSearch ? 'Close search' : 'Search notes'}
            title={showSearch ? 'Close search' : 'Search notes'}
            className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 transition active:scale-95"
          >
            {showSearch ? <X size={18} /> : <Search size={18} />}
          </button>
          <Link
            href="/notes/new"
            aria-label="New Note"
            title="New Note"
            className="inline-block transition hover:opacity-90 active:opacity-80 shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/addnote.png"
              alt="New Note"
              width={64}
              height={64}
              className="block h-16 w-16 object-contain"
            />
          </Link>
        </div>
      </div>

      {/* Desktop-only collapsible search (mobile has it pinned above) */}
      {showSearch && (
        <div className="hidden md:block mb-5">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeSearch() }}
              placeholder="Search titles and contents on this page…"
              className="w-full pl-9 pr-9 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-accent-500/50 focus:border-accent-500 transition"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-700 transition"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {allNotes.length === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-stone-800 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/cobb/notes.png" width={64} height={64} alt="" className="object-contain mx-auto mb-3 rounded" />
          <p className="font-medium text-stone-400">No notes yet.</p>
          <Link href="/notes/new" className="mt-2 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition">
            + Write first note
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-stone-800 rounded-xl">
          <p className="font-medium text-stone-400">No notes match &ldquo;{query}&rdquo;.</p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 transition"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((note) => {
            const cat = note.categoryId ? categoriesById?.[note.categoryId] : null
            return (
              <NoteCard
                key={note.id}
                note={note}
                categoryLabel={cat?.label ?? null}
                categorySlug={cat?.slug ?? null}
                attachmentCount={attachmentCounts?.[note.id]}
              />
            )
          })}
        </div>
      )}
    </>
  )
}
