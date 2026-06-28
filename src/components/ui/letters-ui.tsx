'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Lock, Mail, Mic, Paperclip, Plus, Send, Trash2, Video, X } from 'lucide-react'
import { upload } from '@vercel/blob/client'
import { createLetter, createLetterToParent, deleteLetter, saveLetterMetadata } from '@/lib/actions/letters'
import type { LetterRecipient } from '@/lib/letters-recipients'
import { formatBytes } from '@/lib/format'
import { acquireWakeLock, releaseWakeLock } from '@/lib/wake-lock'
import { MediaLetterRecorder } from './media-letter-recorder'

type Letter = {
  id: string
  recipientName: string
  title: string
  body: string
  fileUrl: string | null
  fileName: string | null
  contentType: string | null
  size: number | null
  direction: string
  unlockAt: Date | null
  createdBy: string
  createdAt: Date
}

interface ParentRecipient {
  slug: string
  display: string
  emails: string[]
}

interface Props {
  recipients: LetterRecipient[]
  parentRecipients: ParentRecipient[]
  /** First-name slug of the logged-in user, if it matches a recipient. Null
   *  for Lance (he sees all via isSuperuser) and for users whose name doesn't
   *  match any slot. */
  myRecipientSlug: string | null
  /** Slug of the parent slot the current user owns (Lance / Heather). */
  myParentSlug: string | null
  isSuperuser: boolean
  currentUserId: string
  /** 'gift' letters grouped by kid recipient (release-gated). */
  lettersByRecipient: Record<string, Letter[]>
  /** 'note-to' letters (kid → parent) grouped by parent slug. */
  noteToByParent: Record<string, Letter[]>
  /** Count for every recipient. Used to render counts on locked tiles too. */
  countByRecipient: Record<string, number>
}

export function LettersUI({
  recipients,
  parentRecipients,
  myRecipientSlug,
  myParentSlug,
  isSuperuser,
  currentUserId,
  lettersByRecipient,
  noteToByParent,
  countByRecipient,
}: Props) {
  const [composeFor, setComposeFor] = useState<string | null>(null)
  const [composeKidToParent, setComposeKidToParent] = useState<string | null>(null)

  return (
    <div className="space-y-8">
      {/* ─── Parent-to-kid letter cards (existing behavior) ─── */}
      <section>
        <header className="mb-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-stone-500">From the keeper</p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {recipients.map((r) => {
            const isOwn = r.slug === myRecipientSlug
            const canRead = isSuperuser || isOwn
            const list = lettersByRecipient[r.slug] ?? []
            const count = countByRecipient[r.slug] ?? 0
            return canRead ? (
              <OpenVaultCard
                key={r.slug}
                recipient={r}
                letters={list}
                isSuperuser={isSuperuser}
                onCompose={() => setComposeFor(r.slug)}
              />
            ) : (
              <LockedSiblingCard key={r.slug} recipient={r} count={count} />
            )
          })}
        </div>
      </section>

      {/* ─── Kid-to-parent inbox cards (new) ─── */}
      <section>
        <header className="mb-4 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-purple-300/70">Letters to mom &amp; dad</p>
          <p className="text-xs text-stone-500 mt-1.5 italic max-w-md mx-auto">
            Private letters — only the parent you write to can read them.
            We can&rsquo;t see each other&rsquo;s. Senders see what they sent.
          </p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {parentRecipients.map((p) => {
            const list = noteToByParent[p.slug] ?? []
            const isMyInbox = p.slug === myParentSlug
            return (
              <ParentInboxCard
                key={p.slug}
                parent={p}
                letters={list}
                isMyInbox={isMyInbox}
                currentUserId={currentUserId}
                onCompose={() => setComposeKidToParent(p.slug)}
              />
            )
          })}
        </div>
      </section>

      {composeFor && (
        <ComposeModal
          recipients={recipients}
          initialSlug={composeFor}
          onClose={() => setComposeFor(null)}
        />
      )}

      {composeKidToParent && (
        <ComposeKidToParentModal
          parents={parentRecipients}
          initialSlug={composeKidToParent}
          onClose={() => setComposeKidToParent(null)}
        />
      )}
    </div>
  )
}

function ParentInboxCard({
  parent,
  letters,
  isMyInbox,
  currentUserId,
  onCompose,
}: {
  parent: ParentRecipient
  letters: Letter[]
  isMyInbox: boolean
  currentUserId: string
  onCompose: () => void
}) {
  // Letters in here are either: addressed to me (if isMyInbox) OR I sent
  // them. The other parent doesn't see this card's contents.
  return (
    <div className="relative rounded-2xl border border-purple-700/30 bg-gradient-to-br from-purple-950/40 via-stone-900/70 to-black/90 backdrop-blur-md shadow-[0_8px_40px_rgba(126,34,206,0.15)] overflow-hidden">
      <div className="px-4 pt-4 pb-3 text-center">
        <h3 className="text-lg md:text-xl font-serif font-bold text-purple-100">
          To {parent.display}
        </h3>
        <p className="text-[10px] uppercase tracking-[0.2em] text-purple-400/60 mt-1">
          {isMyInbox ? 'Your inbox' : `Send a letter to ${parent.display}`}
        </p>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <button
          type="button"
          onClick={onCompose}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-purple-400/30 bg-purple-500/10 hover:bg-purple-500/20 py-2 text-sm font-medium text-purple-200 transition"
        >
          <Send size={14} />
          Write a letter to {parent.display}
        </button>

        {letters.length === 0 ? (
          <p className="text-sm italic text-stone-500 text-center py-4">
            {isMyInbox ? 'No letters yet.' : 'Nothing sent here yet.'}
          </p>
        ) : (
          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {letters.map((l) => (
              <NoteToLetterRow
                key={l.id}
                letter={l}
                isAuthor={l.createdBy === currentUserId}
                isRecipient={isMyInbox}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function NoteToLetterRow({
  letter,
  isAuthor,
  isRecipient,
}: {
  letter: Letter
  isAuthor: boolean
  isRecipient: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isLocked = letter.unlockAt && letter.unlockAt > new Date() && !isAuthor
  const date = new Date(letter.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  function onDelete() {
    if (!confirm(`Delete "${letter.title}"? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteLetter(letter.id)
      router.refresh()
    })
  }

  if (isLocked) {
    return (
      <li className="rounded-xl border border-purple-800/40 bg-purple-950/20 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Lock size={14} className="mt-1 shrink-0 text-purple-400/70" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-stone-100/80 truncate">{letter.title}</div>
            <div className="text-[11px] text-purple-300/70 mt-0.5">
              Unlocks {letter.unlockAt!.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/[0.07] transition">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
      >
        <Send size={14} className="mt-1 shrink-0 text-purple-300/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-100 truncate">{letter.title}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            {date}
            {isAuthor && <span className="ml-2 text-purple-400/70">(you sent this)</span>}
            {!isAuthor && isRecipient && <span className="ml-2 text-purple-400/70">(to you)</span>}
          </div>
        </div>
        {letter.fileUrl && <Paperclip size={12} className="mt-1 shrink-0 text-stone-400" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {letter.body && (
            <p className="text-sm text-stone-200 whitespace-pre-wrap leading-relaxed">{letter.body}</p>
          )}
          {letter.fileUrl && <LetterAttachment letter={letter} />}
          {(isAuthor || isRecipient) && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={11} />
                {isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ComposeKidToParentModal({
  parents,
  initialSlug,
  onClose,
}: {
  parents: ParentRecipient[]
  initialSlug: string
  onClose: () => void
}) {
  const router = useRouter()
  const [slug, setSlug] = useState(initialSlug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unlockAt, setUnlockAt] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await createLetterToParent({
      recipientSlug: slug,
      title: ((fd.get('title') as string) ?? '').trim(),
      body: ((fd.get('body') as string) ?? '').trim(),
      unlockAt: unlockAt || null,
    })
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    router.refresh()
    onClose()
  }

  const target = parents.find((p) => p.slug === slug)?.display ?? 'them'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={() => { if (!busy) onClose() }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-950/95 to-black/95 shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-purple-500/20 shrink-0">
          <h2 className="text-base md:text-lg font-serif font-bold text-purple-50">
            A letter for {target}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-1.5 rounded text-stone-400 hover:text-stone-100 hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 bg-purple-950/30 border-b border-purple-500/20">
          <p className="text-xs text-purple-200/90 leading-relaxed">
            🔒 Only {target} will see this. Other family members
            (siblings, the other parent, even Lance as superuser) cannot read it.
          </p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-purple-300/80 mb-1.5">
              To
            </label>
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-purple-400/20 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400/40"
            >
              {parents.map((p) => (
                <option key={p.slug} value={p.slug}>{p.display}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-purple-300/80 mb-1.5">
              Title
            </label>
            <input
              required
              name="title"
              maxLength={200}
              autoFocus
              placeholder="e.g. Thank you for…"
              className="w-full px-3 py-2 bg-black/40 border border-purple-400/20 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-purple-300/80 mb-1.5">
              Letter
            </label>
            <textarea
              name="body"
              rows={8}
              maxLength={20000}
              placeholder={`Write to ${target}...`}
              className="w-full px-3 py-2 bg-black/40 border border-purple-400/20 rounded-lg text-stone-100 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-purple-300/80 mb-1.5">
              Time-lock <span className="text-stone-500 lowercase">(optional)</span>
            </label>
            <input
              type="date"
              value={unlockAt}
              onChange={(e) => setUnlockAt(e.target.value)}
              className="px-3 py-2 bg-black/40 border border-purple-400/20 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-400/40"
            />
            <p className="text-[11px] text-stone-500 mt-1">
              {target} can&rsquo;t open the letter until this date. You can still see it (so you can edit it later if you want).
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-purple-500/20 bg-black/40 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-stone-300 hover:text-stone-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
          >
            {busy ? (
              <>
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                Sending…
              </>
            ) : (
              'Send letter'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

function FolderImage({ recipient, dimmed = false }: { recipient: LetterRecipient; dimmed?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={recipient.folderImg}
      alt={`Letters for ${recipient.display}`}
      className={`block w-full h-auto object-contain select-none ${dimmed ? 'opacity-65 saturate-75' : ''}`}
      draggable={false}
    />
  )
}

function OpenVaultCard({
  recipient,
  letters,
  isSuperuser,
  onCompose,
}: {
  recipient: LetterRecipient
  letters: Letter[]
  isSuperuser: boolean
  onCompose: () => void
}) {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-950/60 via-stone-900/80 to-black/90 backdrop-blur-md shadow-[0_8px_40px_rgba(76,29,149,0.15)] overflow-hidden">
      <FolderImage recipient={recipient} />

      <div className="px-4 pb-4 pt-2 space-y-3">
        <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500 text-center">
          {letters.length} {letters.length === 1 ? 'letter' : 'letters'}
        </p>

        {isSuperuser && (
          <button
            type="button"
            onClick={onCompose}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 py-2 text-sm font-medium text-emerald-200 transition"
          >
            <Plus size={14} />
            Add a letter for {recipient.display}
          </button>
        )}

        {letters.length === 0 ? (
          <p className="text-sm italic text-stone-500 text-center py-4">
            No letters yet.
          </p>
        ) : (
          <YearGroupedLetters letters={letters} isSuperuser={isSuperuser} />
        )}
      </div>
    </div>
  )
}

function LockedSiblingCard({ recipient, count }: { recipient: LetterRecipient; count: number }) {
  return (
    <div
      className="relative rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden"
      title="These are not yours to read"
    >
      <div className="relative">
        <FolderImage recipient={recipient} dimmed />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="rounded-full bg-black/70 p-4 border border-amber-300/40 shadow-lg">
            <Lock size={28} className="text-amber-300/90" />
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 text-center">
        <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500">
          {count} {count === 1 ? 'letter' : 'letters'}
        </p>
        <p className="text-xs italic text-stone-500 mt-1.5">
          These are not yours to read.
        </p>
      </div>
    </div>
  )
}

/**
 * Renders a letter's attachment using a proxy URL that handles auth + the
 * release gate. Plays audio / video inline so family members can listen
 * or watch in-page; everything else gets a download link.
 *
 * Why proxy: the blob is uploaded with access:'private', so the raw blob
 * URL returns 403 to a browser <video src=...>. /api/letters/[id]/file
 * verifies the request, fetches the blob with our token, and streams it
 * back with Range-request support so video seeking works.
 */
function LetterAttachment({ letter }: { letter: Letter }) {
  const proxyUrl = `/api/letters/${letter.id}/file`
  const ct = letter.contentType ?? ''

  if (ct.startsWith('video/')) {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10 bg-black">
        <video controls preload="metadata" src={proxyUrl} className="block w-full max-h-96" />
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-black/40 border-t border-white/10 text-[11px] text-stone-400">
          <span className="truncate">{letter.fileName ?? 'Video'}</span>
          {letter.size != null && <span>{formatBytes(letter.size)}</span>}
        </div>
      </div>
    )
  }
  if (ct.startsWith('audio/')) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/30 p-2 space-y-1.5">
        <audio controls preload="metadata" src={proxyUrl} className="block w-full" />
        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-stone-400">
          <span className="truncate">{letter.fileName ?? 'Audio'}</span>
          {letter.size != null && <span>{formatBytes(letter.size)}</span>}
        </div>
      </div>
    )
  }
  if (ct.startsWith('image/')) {
    return (
      <a
        href={proxyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg overflow-hidden border border-white/10 bg-black/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proxyUrl} alt={letter.fileName ?? ''} className="block w-full max-h-96 object-contain" />
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-black/40 border-t border-white/10 text-[11px] text-stone-400">
          <span className="truncate">{letter.fileName ?? 'Image'}</span>
          {letter.size != null && <span>{formatBytes(letter.size)}</span>}
        </div>
      </a>
    )
  }
  // Other (pdf, doc, txt, etc.) — render as a download link.
  return (
    <a
      href={proxyUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200"
    >
      <Paperclip size={12} />
      <span>{letter.fileName ?? 'Attachment'}</span>
      {letter.size != null && (
        <span className="text-stone-500">({formatBytes(letter.size)})</span>
      )}
    </a>
  )
}

/**
 * Year-grouped accordion. Years run newest → oldest; within each year,
 * letters run oldest → newest (Jan → Dec) so reading top-to-bottom feels
 * like turning calendar pages forward. The most recent year is open by
 * default; the rest collapse so a recipient with five years of letters
 * doesn't have to scroll past everything to find the newest.
 */
function YearGroupedLetters({
  letters,
  isSuperuser,
}: {
  letters: Letter[]
  isSuperuser: boolean
}) {
  const groups = useMemo(() => {
    const byYear = new Map<number, Letter[]>()
    for (const l of letters) {
      const y = new Date(l.createdAt).getFullYear()
      const bucket = byYear.get(y) ?? []
      bucket.push(l)
      byYear.set(y, bucket)
    }
    return Array.from(byYear.entries())
      .sort(([a], [b]) => b - a)
      .map(([year, list]) => ({
        year,
        letters: list
          .slice()
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      }))
  }, [letters])

  const [openYears, setOpenYears] = useState<Set<number>>(() => new Set())

  function toggle(year: number) {
    setOpenYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
      <div className="text-[10px] uppercase tracking-[0.25em] text-stone-500 text-center pb-1">
        Choose a year
      </div>
      {groups.map((g) => {
        const open = openYears.has(g.year)
        return (
          <div
            key={g.year}
            className="rounded-xl border border-white/10 bg-white/5 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggle(g.year)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-white/[0.07] transition"
              aria-expanded={open}
            >
              <span className="font-semibold text-stone-100 text-sm">{g.year}</span>
              <span className="flex items-center gap-2 text-[11px] text-stone-500">
                <span>
                  {g.letters.length} {g.letters.length === 1 ? 'letter' : 'letters'}
                </span>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>
            {open && (
              <ul className="border-t border-white/10 p-2 space-y-2">
                {g.letters.map((l) => (
                  <LetterRow key={l.id} letter={l} isSuperuser={isSuperuser} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function LetterRow({ letter, isSuperuser }: { letter: Letter; isSuperuser: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function onDelete() {
    if (!confirm(`Delete "${letter.title}"? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteLetter(letter.id)
      router.refresh()
    })
  }

  const date = new Date(letter.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <li className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm hover:bg-white/[0.07] transition">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2"
      >
        <Mail size={14} className="mt-1 shrink-0 text-indigo-300/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-stone-100 truncate">{letter.title}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">{date}</div>
        </div>
        {letter.fileUrl && (
          <Paperclip size={12} className="mt-1 shrink-0 text-stone-400" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {letter.body && (
            <p className="text-sm text-stone-200 whitespace-pre-wrap leading-relaxed">
              {letter.body}
            </p>
          )}
          {letter.fileUrl && (
            <LetterAttachment letter={letter} />
          )}
          {isSuperuser && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={11} />
                {isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ComposeModal({
  recipients,
  initialSlug,
  onClose,
}: {
  recipients: LetterRecipient[]
  initialSlug: string
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState(initialSlug)
  // In-page audio/video recordings live here until save.
  const [recordedFile, setRecordedFile] = useState<File | null>(null)
  const [recordedPreview, setRecordedPreview] = useState<string | null>(null)
  const [recorderMode, setRecorderMode] = useState<'audio' | 'video' | null>(null)
  // Direct-to-blob upload progress (0–100). Only meaningful when uploading
  // a file. null = no upload in flight, just submitting metadata.
  const [uploadPct, setUploadPct] = useState<number | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Revoke the playback URL on unmount or when the recording is replaced.
  useEffect(() => {
    return () => {
      if (recordedPreview) URL.revokeObjectURL(recordedPreview)
    }
  }, [recordedPreview])

  function acceptRecording(file: File) {
    if (recordedPreview) URL.revokeObjectURL(recordedPreview)
    setRecordedFile(file)
    setRecordedPreview(URL.createObjectURL(file))
  }

  function clearRecording() {
    if (recordedPreview) URL.revokeObjectURL(recordedPreview)
    setRecordedFile(null)
    setRecordedPreview(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('recipientName', slug)

    // Pick the file from the picker, or override with the recorded one.
    const pickedFile = fd.get('file')
    const file: File | null = recordedFile
      ? recordedFile
      : pickedFile instanceof File && pickedFile.size > 0
        ? pickedFile
        : null

    // Direct-to-blob path for ANY file. Server actions cap request bodies
    // at ~4.5 MB, so a video letter (10–30 MB) silently hangs going
    // through createLetter. upload() streams straight to Vercel Blob.
    if (file) {
      const wakeLock = await acquireWakeLock()
      try {
        setUploadPct(0)
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
        const blob = await upload(`letters/${slug}/${Date.now()}-${safeName}`, file, {
          access: 'private',
          handleUploadUrl: '/api/letters/upload-token',
          clientPayload: JSON.stringify({ recipient: slug }),
          onUploadProgress: (p) => setUploadPct(Math.round(p.percentage)),
        })
        const result = await saveLetterMetadata({
          recipientName: slug,
          title: (fd.get('title') as string) ?? '',
          body: (fd.get('body') as string) ?? '',
          fileUrl: blob.url,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
        })
        if (result?.error) {
          setError(result.error)
          setBusy(false)
          setUploadPct(null)
          return
        }
        setUploadPct(null)
        setBusy(false)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
        setBusy(false)
        setUploadPct(null)
      } finally {
        await releaseWakeLock(wakeLock)
      }
      return
    }

    // Text-only letter — fits comfortably under the 4.5 MB body cap.
    const result = await createLetter(fd)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    onClose()
  }

  const recipientName = recipients.find((r) => r.slug === slug)?.display ?? 'them'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={() => { if (!busy) onClose() }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-950/95 to-black/95 shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]"
      >
        {/* Cap the modal at viewport height + scroll the body so a staged
            audio/video preview can't push the Save Letter footer off-screen.
            dvh handles iOS Safari's URL bar shrinking. */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-white/10 shrink-0">
          <h2 className="text-base md:text-lg font-serif font-bold text-stone-50 min-w-0 truncate">
            A letter for {recipientName}
          </h2>
          {/* Primary Save Letter button up top — always visible without
              needing to scroll past a staged video. The bottom footer
              still has it too for the muscle-memory case. */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
            >
              {busy ? (
                <>
                  <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  {uploadPct != null ? `Uploading ${uploadPct}%` : 'Saving…'}
                </>
              ) : (
                'Save letter'
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="p-1.5 rounded text-stone-400 hover:text-stone-100 hover:bg-white/5"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* flex-1 min-h-0 forces this section to actually obey the modal's
            max-h cap and overflow internally. Without min-h-0, the body
            grows to its content size and pushes the footer off-screen. */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-400 mb-1.5">
              Recipient
            </label>
            <select
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400/40"
            >
              {recipients.map((r) => (
                <option key={r.slug} value={r.slug}>{r.display}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-400 mb-1.5">
              Title
            </label>
            <input
              required
              name="title"
              maxLength={200}
              autoFocus
              placeholder="e.g. The day you were born"
              className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-400 mb-1.5">
              Letter
            </label>
            <textarea
              name="body"
              rows={8}
              maxLength={20000}
              placeholder="Write to them..."
              className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-lg text-stone-100 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-400 mb-1.5">
              Attachment <span className="text-stone-600 lowercase">(optional)</span>
            </label>
            <input
              name="file"
              type="file"
              disabled={!!recordedFile}
              accept="image/*,application/pdf,.doc,.docx,.txt,audio/*,video/*"
              className="w-full text-sm text-stone-300 file:mr-3 file:rounded-md file:border-0 file:bg-stone-800 file:px-3 file:py-1.5 file:text-stone-200 file:cursor-pointer hover:file:bg-stone-700 disabled:opacity-40"
            />
            {/* Record-in-page paths. Either replaces a manually-picked file
                so the user can record a quick voice or video letter without
                leaving the form. */}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRecorderMode('audio')}
                disabled={!!recordedFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-pink-900/40 border border-stone-700 hover:border-pink-700/50 text-stone-300 hover:text-pink-200 rounded-lg transition disabled:opacity-50"
              >
                <Mic size={13} />
                Record voice
              </button>
              <button
                type="button"
                onClick={() => setRecorderMode('video')}
                disabled={!!recordedFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-sky-900/40 border border-stone-700 hover:border-sky-700/50 text-stone-300 hover:text-sky-200 rounded-lg transition disabled:opacity-50"
              >
                <Video size={13} />
                Record video
              </button>
            </div>
            {recordedFile && recordedPreview && (
              <div className="mt-3 rounded-lg border border-stone-700 bg-stone-800/40 p-3">
                {/* SAVE BUTTON RIGHT HERE, ABOVE THE VIDEO — when a
                    recording is staged, this is the next thing the user
                    sees. No scrolling past the video to hunt for the
                    save button anywhere. */}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 mb-3 text-base font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
                >
                  {busy ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {uploadPct != null ? `Uploading ${uploadPct}%…` : 'Saving letter…'}
                    </>
                  ) : (
                    'Save letter'
                  )}
                </button>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-emerald-300">
                    Recorded {recordedFile.type.startsWith('video/') ? 'video' : 'voice'}
                  </span>
                  <button
                    type="button"
                    onClick={clearRecording}
                    className="text-xs text-stone-500 hover:text-red-400 transition"
                  >
                    Discard
                  </button>
                </div>
                {recordedFile.type.startsWith('video/') ? (
                  <video controls src={recordedPreview} className="w-full max-h-56 rounded bg-black" />
                ) : (
                  <audio controls src={recordedPreview} className="w-full" />
                )}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer pinned to the bottom of the modal — shrink-0 keeps it
            outside the scroll area, so the Save Letter button stays
            visible no matter how tall the staged recording or body
            content is. */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 bg-black/40 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-stone-300 hover:text-stone-100 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
          >
            {busy ? (
              <>
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                {uploadPct != null ? `Uploading ${uploadPct}%` : 'Saving…'}
              </>
            ) : (
              'Save letter'
            )}
          </button>
        </div>
      </form>

      {recorderMode && (
        <MediaLetterRecorder
          mode={recorderMode}
          recipientName={recipients.find((r) => r.slug === slug)?.display ?? 'them'}
          onSave={(file) => acceptRecording(file)}
          onClose={() => setRecorderMode(null)}
        />
      )}
    </div>
  )
}
