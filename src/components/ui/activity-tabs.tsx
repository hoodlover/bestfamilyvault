'use client'

// Tabbed Recents widget. Replaces the three separate Favorites /
// Recently Updated / Recent Notes sections at the bottom of the
// dashboard with a single tabbed surface. Cuts ~3 vertical sections
// down to one without losing any data — same grid shape, same cards,
// same per-user favorite overrides.
//
// Default tab: Favorites when the user has any, else Recent. Notes only
// shows the Notes tab when there are recent notes to display, so a vault
// with no notes doesn't see an empty tab.

import { useState } from 'react'
import { Star, Clock, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { EntryCard } from './entry-card'
import { NoteCard } from './note-card'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries, notes } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>
type Note = InferSelectModel<typeof notes>

interface Props {
  favorites: Entry[]
  recents: Entry[]
  recentNotes: Note[]
  favEntryIds: Set<string>
  favNoteIds: Set<string>
  catMap: Record<string, string>
  canEdit: boolean
  /** Per-note attachment counts keyed by note id. Drives the paperclip
   *  chip on the Notes tab cards. Plain Record (not Map) so it
   *  serialises through the server→client boundary. */
  noteAttachmentCounts?: Record<string, number>
}

type TabKey = 'favorites' | 'recent' | 'notes'

export function ActivityTabs({
  favorites,
  recents,
  recentNotes,
  favEntryIds,
  favNoteIds,
  catMap,
  canEdit,
  noteAttachmentCounts,
}: Props) {
  const hasFavorites = favorites.length > 0
  const hasNotes = recentNotes.length > 0
  const [tab, setTab] = useState<TabKey>(hasFavorites ? 'favorites' : 'recent')

  // If everything is empty, still render the Recent tab so the empty
  // state message survives — that's the legacy behavior on a fresh
  // vault and we don't want to silently drop it.
  return (
    <section className="mb-8 md:mb-10">
      <div className="flex items-center gap-1.5 mb-3 border-b border-stone-800/80">
        <TabButton
          icon={Star}
          label="Favorites"
          count={favorites.length}
          active={tab === 'favorites'}
          accent="emerald"
          onClick={() => setTab('favorites')}
        />
        <TabButton
          icon={Clock}
          label="Recent"
          count={recents.length}
          active={tab === 'recent'}
          accent="stone"
          onClick={() => setTab('recent')}
        />
        {hasNotes && (
          <TabButton
            icon={FileText}
            label="Notes"
            count={recentNotes.length}
            active={tab === 'notes'}
            accent="stone"
            onClick={() => setTab('notes')}
          />
        )}
      </div>

      {tab === 'favorites' && (
        <FavoritesPanel
          favorites={favorites}
          favEntryIds={favEntryIds}
          catMap={catMap}
          canEdit={canEdit}
        />
      )}

      {tab === 'recent' && (
        <RecentPanel
          recents={recents}
          favEntryIds={favEntryIds}
          catMap={catMap}
          canEdit={canEdit}
        />
      )}

      {tab === 'notes' && (
        <NotesPanel
          recentNotes={recentNotes}
          favNoteIds={favNoteIds}
          noteAttachmentCounts={noteAttachmentCounts}
        />
      )}
    </section>
  )
}

function TabButton({
  icon: Icon,
  label,
  count,
  active,
  accent,
  onClick,
}: {
  icon: React.ElementType
  label: string
  count: number
  active: boolean
  accent: 'emerald' | 'stone'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-medium transition',
        active
          ? accent === 'emerald'
            ? 'border-emerald-400 text-emerald-200'
            : 'border-stone-300 text-stone-100'
          : 'border-transparent text-stone-500 hover:text-stone-300',
      )}
      aria-pressed={active}
    >
      <Icon size={14} className={active && accent === 'emerald' ? 'text-emerald-400' : undefined} />
      {label}
      {count > 0 && (
        <span
          className={clsx(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
            active
              ? accent === 'emerald'
                ? 'bg-emerald-500 text-stone-950'
                : 'bg-stone-200 text-stone-900'
              : 'bg-stone-800 text-stone-400',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function FavoritesPanel({
  favorites,
  favEntryIds,
  catMap,
  canEdit,
}: {
  favorites: Entry[]
  favEntryIds: Set<string>
  catMap: Record<string, string>
  canEdit: boolean
}) {
  if (favorites.length === 0) {
    return (
      <EmptyState
        message="No favorites yet."
        sub="Tap the star on any entry to pin it here."
      />
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
      {favorites.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          categoryName={catMap[entry.categoryId]}
          canEdit={canEdit}
          isFavoriteOverride={favEntryIds.has(entry.id)}
        />
      ))}
    </div>
  )
}

function RecentPanel({
  recents,
  favEntryIds,
  catMap,
  canEdit,
}: {
  recents: Entry[]
  favEntryIds: Set<string>
  catMap: Record<string, string>
  canEdit: boolean
}) {
  if (recents.length === 0) {
    return (
      <div className="text-center py-12 text-stone-500 border border-stone-800 rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/privatevault.png"
          width={48}
          height={48}
          alt=""
          className="object-contain mx-auto mb-3 rounded"
        />
        <p className="font-medium text-stone-400">The vault is empty.</p>
        <p className="text-sm mt-1">Add your first entry to get started.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
      {recents.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          categoryName={catMap[entry.categoryId]}
          canEdit={canEdit}
          isFavoriteOverride={favEntryIds.has(entry.id)}
        />
      ))}
    </div>
  )
}

function NotesPanel({
  recentNotes,
  favNoteIds,
  noteAttachmentCounts,
}: {
  recentNotes: Note[]
  favNoteIds: Set<string>
  noteAttachmentCounts?: Record<string, number>
}) {
  if (recentNotes.length === 0) {
    return <EmptyState message="No recent notes." sub="" />
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
      {recentNotes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          isFavoriteOverride={favNoteIds.has(note.id)}
          attachmentCount={noteAttachmentCounts?.[note.id]}
        />
      ))}
    </div>
  )
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="text-center py-8 text-stone-500 border border-stone-800 rounded-xl">
      <p className="font-medium text-stone-400">{message}</p>
      {sub && <p className="text-sm mt-1">{sub}</p>}
    </div>
  )
}
