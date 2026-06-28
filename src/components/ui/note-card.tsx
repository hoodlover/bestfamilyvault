import Link from 'next/link'
import { Star, FileText, Paperclip } from 'lucide-react'
import type { InferSelectModel } from 'drizzle-orm'
import type { notes } from '@/lib/db/schema'
import { stripHtml } from '@/lib/format'
import { abbreviateRecipeTag, isRecipeTag } from '@/lib/recipe-tag-abbrev'

type Note = InferSelectModel<typeof notes>

// Per-category pill colors. Each value is a stone/colored mix; the
// shades match the rest of the mobile redesign tokens so a Finance
// pill blends with the chosen accent theme. Unknown slugs fall through
// to a neutral stone treatment. Pure presentational map — feel free to
// add more slugs as new categories appear.
const CATEGORY_PILL: Record<string, string> = {
  finance: 'text-emerald-200 bg-emerald-950/35 border-emerald-800/45',
  finances: 'text-emerald-200 bg-emerald-950/35 border-emerald-800/45',
  family: 'text-rose-200 bg-rose-950/30 border-rose-800/45',
  kids: 'text-rose-200 bg-rose-950/30 border-rose-800/45',
  home: 'text-amber-200 bg-amber-950/30 border-amber-800/45',
  'our-places': 'text-amber-200 bg-amber-950/30 border-amber-800/45',
  properties: 'text-amber-200 bg-amber-950/30 border-amber-800/45',
  auto: 'text-sky-200 bg-sky-950/30 border-sky-800/45',
  health: 'text-teal-200 bg-teal-950/30 border-teal-800/45',
  travel: 'text-amber-200 bg-amber-950/30 border-amber-800/45',
  business: 'text-orange-200 bg-orange-950/30 border-orange-800/45',
  tech: 'text-cyan-200 bg-cyan-950/30 border-cyan-800/45',
  entertainment: 'text-cyan-200 bg-cyan-950/30 border-cyan-800/45',
  recipes: 'text-amber-200 bg-amber-950/30 border-amber-800/45',
}
const CATEGORY_PILL_FALLBACK = 'text-stone-300 bg-stone-800/50 border-stone-700/50'

export function NoteCard({
  note,
  isFavoriteOverride,
  categoryLabel,
  categorySlug,
  attachmentCount,
}: {
  note: Note
  isFavoriteOverride?: boolean
  /** Per-card category label (e.g. "Finances") — when set, a colored
   *  pill renders in the footer. Optional so existing call sites that
   *  don't pass categories keep their old date-only footer. */
  categoryLabel?: string | null
  /** Slug used to color the pill. Falls back to a neutral stone tint
   *  when the slug isn't in CATEGORY_PILL. */
  categorySlug?: string | null
  /** Number of files attached to this note. When > 0, a Paperclip
   *  chip renders next to the type label — same at-a-glance signal
   *  EntryCard already carries. Undefined / 0 hides the chip. */
  attachmentCount?: number
}) {
  // Only recipe-subcategory tags get pills — keeps generic notes
  // (IDNW letters etc.) from displaying their own tag scheme as
  // abbrev pills they were never designed for.
  const recipeTags = (note.tags ?? []).filter(isRecipeTag)
  const pillClass = categorySlug
    ? CATEGORY_PILL[categorySlug] ?? CATEGORY_PILL_FALLBACK
    : CATEGORY_PILL_FALLBACK

  return (
    <Link
      href={`/notes/${note.id}`}
      className="group flex flex-col rounded-xl p-4 vault-card vault-card-hover"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-yellow-400" />
          <span className="text-xs font-medium text-stone-500">Note</span>
          {note.isPrivate && <img src="/icons/cobb/privatevault.png" width={11} height={11} alt="" className="object-contain opacity-80" />}
          {/* Attachment chip — same sky-tinted Paperclip pill that EntryCard
              shows, so the "this card has files" signal reads the same way
              across both entry types. */}
          {attachmentCount != null && attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded px-1 py-0.5"
              title={`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
            >
              <Paperclip size={9} />
              {attachmentCount}
            </span>
          )}
        </div>
        {/* Gold star (treasure hue, theme-independent) — favorites are
            consistent across every accent theme so a Crimson user still
            sees the star, not a same-colored blob against accent chrome. */}
        {(isFavoriteOverride ?? note.isFavorite) && <Star size={14} className="text-[#d8a531] fill-[#d8a531]" />}
      </div>

      <h3 className="text-sm font-semibold text-stone-200 group-hover:text-white leading-snug line-clamp-2 break-words mb-1">
        {note.title}
      </h3>

      {note.content && (
        <p className="text-xs text-stone-500 line-clamp-2">{stripHtml(note.content)}</p>
      )}

      <div className="flex items-end justify-between gap-2 mt-auto pt-2">
        {categoryLabel ? (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillClass}`}
            title={categoryLabel}
          >
            {categoryLabel}
          </span>
        ) : (
          <p className="text-xs text-stone-600">
            {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : ''}
          </p>
        )}
        <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
          {categoryLabel && note.updatedAt && (
            <span className="text-[11px] text-stone-600">
              {new Date(note.updatedAt).toLocaleDateString()}
            </span>
          )}
          {recipeTags.slice(0, 4).map((t) => (
            <span
              key={t}
              title={t}
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider text-emerald-300 bg-emerald-950/40 border border-emerald-800/40"
            >
              {abbreviateRecipeTag(t)}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
