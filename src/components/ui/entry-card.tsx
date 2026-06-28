'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Star, Globe, CreditCard, Building2, User, FileText, Lock, Eye, X, Check, CheckSquare, Square, Pencil, Paperclip, Home } from 'lucide-react'
import { clsx } from 'clsx'
import { deleteEntry } from '@/lib/actions/entries'
import { prettyHost } from '@/lib/format-url'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>

interface Props {
  entry: Entry
  categoryName?: string
  subcategoryName?: string
  canEdit?: boolean
  selectMode?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
  /** Per-user favorite state (entry_favorite join). When provided, overrides
   *  the legacy entries.is_favorite column so each user sees their own stars. */
  isFavoriteOverride?: boolean
  /** URL of the first image attachment for this entry. When set, the
   *  card replaces the generic type icon with a small thumbnail so a
   *  photo-bearing entry is recognizable at a glance. Should be an
   *  auth'd proxy URL like /api/files/<id>?preview=1. */
  previewImageUrl?: string
  /** Number of files attached to this entry. When > 0, the card shows
   *  a small paperclip + count chip in the header so you can spot
   *  cards with attached statements / docs without opening them. The
   *  prop is optional — pages that don't compute the count just skip
   *  the indicator silently. */
  attachmentCount?: number
}

const typeConfig = {
  login:        { icon: Globe,      label: 'Login',    color: 'text-blue-400' },
  note:         { icon: FileText,   label: 'Note',     color: 'text-yellow-400' },
  document:     { icon: FileText,   label: 'Document', color: 'text-orange-400' },
  bank_account: { icon: Building2,  label: 'Bank',     color: 'text-green-400' },
  credit_card:  { icon: CreditCard, label: 'Card',     color: 'text-purple-400' },
  identity:     { icon: User,       label: 'Identity', color: 'text-red-400' },
  asset:        { icon: Home,       label: 'Asset',    color: 'text-emerald-400' },
} as const

export function EntryCard({ entry, categoryName, subcategoryName, canEdit = true, selectMode = false, selected = false, onSelect, isFavoriteOverride, previewImageUrl, attachmentCount }: Props) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)

  const config = typeConfig[entry.type as keyof typeof typeConfig] ?? typeConfig.note
  const Icon = config.icon

  // Best secret value to expose per type
  const secretValue =
    entry.password ||
    entry.accountNumber ||
    (entry.type === 'credit_card' ? entry.cardNumber : null) ||
    (entry.type === 'identity' ? entry.ssn : null) ||
    null

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    await deleteEntry(entry.id)
    router.refresh()
  }

  async function handleRevealCopy() {
    if (!secretValue) return
    try { await navigator.clipboard.writeText(secretValue) } catch {}
    setCopied(true)
    setRevealed(secretValue)
    setTimeout(() => { setCopied(false); setRevealed(null) }, 3000)
  }

  // Card body: same inner layout regardless of mode, but the wrapping element
  // differs (div with click-to-select vs. Link to detail page). Built inline
  // so we don't define a component during render.
  const cardInner = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {selectMode
            ? selected
              ? <CheckSquare size={15} className="shrink-0 text-emerald-400" />
              : <Square size={15} className="shrink-0 text-stone-600" />
            : <Icon size={15} className={clsx('shrink-0', config.color)} />
          }
          <span className="text-xs font-medium text-stone-500">{config.label}</span>
          {entry.isPrivate && <Lock size={11} className="text-emerald-600 shrink-0" />}
          {/* Attachment chip — visible whenever the entry has 1+ files
              attached. Lance asked for at-a-glance visibility so a card
              with a bank statement on it looks different from a card
              that's still missing one. */}
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
        {(isFavoriteOverride ?? entry.isFavorite) && <Star size={14} className="text-[#d8a531] shrink-0 fill-[#d8a531]" />}
      </div>
      {/* Photo preview — first image attachment, if any. Replaces the
          generic type icon as the primary visual cue when the entry has
          a photo. Served through the auth'd file proxy; the route sets
          Content-Disposition: inline when ?preview=1. */}
      {previewImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewImageUrl}
          alt=""
          className="block w-full h-24 object-cover rounded-md border border-stone-700/50 mb-2 bg-stone-900"
          loading="lazy"
        />
      )}
      <h3 className={clsx('text-sm font-semibold leading-snug line-clamp-2 break-words', selected ? 'text-emerald-200' : 'text-stone-200 group-hover:text-white')}>
        {entry.title}
      </h3>
      {entry.username && (
        <p className="text-xs text-stone-500 mt-1 truncate">{entry.username}</p>
      )}
      {entry.url && !entry.username && (
        // Hostname-only display so a long signup-flow URL doesn't dominate
        // the card. Full URL still opens from the entry detail page.
        <p className="text-xs text-stone-500 mt-1 truncate" title={entry.url}>{prettyHost(entry.url)}</p>
      )}
    </>
  )

  return (
    <div
      className={clsx(
        'group flex flex-col rounded-xl border vault-card-hover',
        selectMode && selected
          ? 'bg-emerald-950/40 border-emerald-600/60'
          : 'vault-card'
      )}
    >
      {/* Clickable content area */}
      {selectMode ? (
        <div
          onClick={() => onSelect?.(entry.id)}
          className="flex flex-col p-4 pb-2 cursor-pointer select-none"
        >
          {cardInner}
        </div>
      ) : (
        <Link href={`/entries/${entry.id}`} className="flex flex-col p-4 pb-2">
          {cardInner}
        </Link>
      )}

      {/* Revealed secret value */}
      {revealed && (
        <div className="mx-4 mb-1 px-2 py-1 bg-stone-700/80 border border-stone-600/50 rounded text-xs text-emerald-300 font-mono truncate">
          {revealed}
        </div>
      )}

      {/* Footer: date left | category + actions right.
          For login entries we prefer `passwordUpdatedAt` over the generic
          `updatedAt` so the date reflects when the SECRET last changed,
          not when the title/url/notes were last touched. Falls back to
          `updatedAt` on legacy rows (pre-column-add) that haven't had
          their password edited since the backfill. */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1 gap-2">
        <span className="text-xs text-stone-600 shrink-0" title={
          entry.type === 'login' && entry.passwordUpdatedAt
            ? `Password updated ${new Date(entry.passwordUpdatedAt).toLocaleString()}`
            : entry.updatedAt
              ? `Updated ${new Date(entry.updatedAt).toLocaleString()}`
              : undefined
        }>
          {entry.type === 'login' && (entry.passwordUpdatedAt || entry.updatedAt)
            ? `🔑 ${new Date(entry.passwordUpdatedAt ?? entry.updatedAt!).toLocaleDateString()}`
            : entry.updatedAt
              ? new Date(entry.updatedAt).toLocaleDateString()
              : ''}
        </span>

        <div className="flex items-center gap-1.5 min-w-0">
          {categoryName && (
            <span className="text-xs text-stone-500 truncate max-w-[120px]">
              {categoryName}{subcategoryName ? ` / ${subcategoryName}` : ''}
            </span>
          )}

          {canEdit && !selectMode && (
            <Link
              href={`/entries/${entry.id}/edit`}
              onClick={(e) => e.stopPropagation()}
              title="Edit entry"
              className="shrink-0 p-1 rounded text-stone-600 hover:text-stone-300 transition"
            >
              <Pencil size={13} />
            </Link>
          )}

          {canEdit && !selectMode && secretValue && (
            <button
              type="button"
              onClick={handleRevealCopy}
              title={copied ? 'Copied!' : 'Reveal & copy'}
              className={clsx(
                'shrink-0 p-1 rounded transition',
                copied ? 'text-emerald-400' : 'text-stone-500 hover:text-stone-300'
              )}
            >
              {copied ? <Check size={13} /> : <Eye size={13} />}
            </button>
          )}

          {canEdit && !selectMode && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              title={confirmDelete ? 'Click again to confirm delete' : 'Delete entry'}
              className={clsx(
                'shrink-0 rounded text-xs transition',
                confirmDelete
                  ? 'px-1.5 py-0.5 bg-red-700 hover:bg-red-600 text-white font-medium'
                  : 'p-1 text-stone-600 hover:text-red-400'
              )}
            >
              {confirmDelete ? 'Sure?' : <X size={13} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
