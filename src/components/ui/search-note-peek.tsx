'use client'

// Search-result version of NoteCard. Shows the same card UI but adds a
// peek-eye button that toggles the full content inline — so Lance can
// scan results without opening each one. Decrypted content is already
// in the search action's response.

import { useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, Star, FileText, ExternalLink, Paperclip } from 'lucide-react'
import type { InferSelectModel } from 'drizzle-orm'
import type { notes } from '@/lib/db/schema'
import { stripHtml } from '@/lib/format'

type Note = InferSelectModel<typeof notes>

// searchVault augments each note with attachmentCount (undefined when 0),
// same shape it already adds to entries. The bare Note type doesn't
// carry that, so widen here.
type NoteWithCount = Note & { attachmentCount?: number }

export function SearchNotePeek({ note }: { note: NoteWithCount }) {
  const [revealed, setRevealed] = useState(false)
  const hasContent = !!note.content?.trim()

  return (
    <div className="rounded-xl border bg-stone-800/60 border-stone-700/50 hover:border-stone-600 hover:bg-stone-800 transition flex flex-col p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-yellow-400" />
          <span className="text-xs font-medium text-stone-500">Note</span>
          {note.attachmentCount != null && note.attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded px-1 py-0.5"
              title={`${note.attachmentCount} attachment${note.attachmentCount === 1 ? '' : 's'}`}
            >
              <Paperclip size={9} />
              {note.attachmentCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasContent && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setRevealed((r) => !r) }}
              title={revealed ? 'Hide preview' : 'Peek without opening'}
              aria-label="Peek"
              className="p-1.5 rounded text-stone-500 hover:text-emerald-400 hover:bg-stone-700 transition"
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
          {note.isFavorite && <Star size={14} className="text-[#d8a531] fill-[#d8a531]" />}
          <Link
            href={`/notes/${note.id}`}
            title="Open"
            aria-label="Open note"
            className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-700 transition"
          >
            <ExternalLink size={14} />
          </Link>
        </div>
      </div>

      <Link
        href={`/notes/${note.id}`}
        className="block text-sm font-semibold text-stone-200 hover:text-white truncate mb-1"
      >
        {note.title}
      </Link>

      {hasContent && (
        <p className={`text-xs text-stone-500 ${revealed ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
          {stripHtml(note.content)}
        </p>
      )}

      <p className="text-xs text-stone-600 mt-auto pt-2">
        {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : ''}
      </p>
    </div>
  )
}
