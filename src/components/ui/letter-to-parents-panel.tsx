'use client'

// "Write a letter to Mom or Dad" panel that lives on each user's
// My Vault page. Same kid-to-parent letter flow as before, just
// surfaced where everyone naturally checks in instead of buried on
// the /letters page.
//
// Usage:
//   <LetterToParentsPanel
//     parents={[{ slug: 'lance', display: 'Lance', emails: [...] }]}
//     mySlug={'sydney'}  // current user â€” pre-excluded from recipient list
//   />
//
// Author + recipient see the letter; nobody else. Optional time-lock
// (writer picks a date OR "not yet" which means indefinite).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Send, X, Calendar, Lock } from 'lucide-react'
import { createLetterToParent } from '@/lib/actions/letters'

interface ParentSlot {
  slug: string
  display: string
}

interface Props {
  parents: ParentSlot[]
  /** Current user's slug â€” used to filter themselves out (you can't
   *  write to yourself). null when the user is the OWNER (Lance), who
   *  can write to anyone. */
  mySlug: string | null
  /** First-name preview used in the panel header (e.g. "Sydney"). */
  myDisplayName: string
}

type LockMode = 'none' | 'date' | 'not-yet'

export function LetterToParentsPanel({ parents, mySlug, myDisplayName }: Props) {
  // Exclude the current user from their own recipient list â€” Sydney
  // doesn't need a "Write to Sydney" composer on her own vault.
  const recipientOptions = parents.filter((p) => p.slug !== mySlug)
  if (recipientOptions.length === 0) return null

  const [open, setOpen] = useState(false)
  const [initialSlug, setInitialSlug] = useState<string | null>(null)

  if (!open) {
    return (
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
          Letters
        </h2>
        <div className="rounded-2xl border border-amber-700/30 bg-gradient-to-br from-amber-950/40 via-stone-900/60 to-black/80 p-4 md:p-5">
          <p className="text-sm text-stone-300 leading-relaxed mb-3">
            Write a letter â€” only the person you write to can read it.
            Set an optional unlock date so it stays sealed until that
            day, or pick &ldquo;not yet&rdquo; to keep it indefinitely hidden until
            you change your mind.
          </p>
          <div className="flex flex-wrap gap-2">
            {recipientOptions.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => { setInitialSlug(p.slug); setOpen(true) }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-amber-700/30 hover:bg-amber-600/40 border border-amber-500/30 text-amber-100 rounded-lg transition"
              >
                <Send size={13} />
                Write to {p.display}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] italic text-stone-500">
            See your sent letters and any you&rsquo;ve received at{' '}
            <Link href="/letters" className="text-amber-300 hover:text-amber-200 underline">
              the Letters page
            </Link>.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        Letters
      </h2>
      <LetterComposer
        parents={recipientOptions}
        initialSlug={initialSlug ?? recipientOptions[0].slug}
        myDisplayName={myDisplayName}
        onClose={() => { setOpen(false); setInitialSlug(null) }}
      />
    </section>
  )
}

function LetterComposer({
  parents,
  initialSlug,
  myDisplayName,
  onClose,
}: {
  parents: ParentSlot[]
  initialSlug: string
  myDisplayName: string
  onClose: () => void
}) {
  const [slug, setSlug] = useState(initialSlug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [lockMode, setLockMode] = useState<LockMode>('none')
  const [unlockAt, setUnlockAt] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy && !success) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, success, onClose])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const fd = new FormData(e.currentTarget)

    // "Not yet" â†’ 100-year lock; user can come back and edit/delete
    // any time. "Date" â†’ user-picked unlock. "None" â†’ null.
    let unlockIso: string | null = null
    if (lockMode === 'date' && unlockAt) {
      unlockIso = unlockAt
    } else if (lockMode === 'not-yet') {
      const d = new Date()
      d.setFullYear(d.getFullYear() + 100)
      unlockIso = d.toISOString()
    }

    const result = await createLetterToParent({
      recipientSlug: slug,
      title: ((fd.get('title') as string) ?? '').trim(),
      body: ((fd.get('body') as string) ?? '').trim(),
      unlockAt: unlockIso,
    })
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setSuccess(true)
  }

  const target = parents.find((p) => p.slug === slug)?.display ?? 'them'

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-700/30 bg-emerald-950/40 p-4 md:p-5">
        <p className="text-sm text-emerald-200">
          âœ“ Sent. Only {target} {lockMode === 'not-yet' ? '(once you unlock it)' : lockMode === 'date' ? `(after ${unlockAt})` : ''} can read it.
        </p>
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={() => { setSuccess(false); setLockMode('none'); setUnlockAt('') }}
            className="text-sm text-emerald-300 hover:text-emerald-200 underline"
          >
            Write another
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-stone-400 hover:text-stone-200"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-950/95 to-black/95 p-4 md:p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-serif font-bold text-amber-50">
          A letter for {target}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
          className="p-1.5 rounded text-stone-400 hover:text-stone-100 hover:bg-white/5"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-amber-200/90 leading-relaxed">
        ðŸ”’ Only {target} will see this. Nobody else in the family can
        read it â€” including the other parent.
      </p>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-amber-300/80 mb-1.5">
          To
        </label>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full px-3 py-2 bg-black/40 border border-amber-400/20 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        >
          {parents.map((p) => (
            <option key={p.slug} value={p.slug}>{p.display}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-amber-300/80 mb-1.5">
          Title
        </label>
        <input
          required
          name="title"
          maxLength={200}
          autoFocus
          placeholder={`From ${myDisplayName}`}
          className="w-full px-3 py-2 bg-black/40 border border-amber-400/20 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-amber-300/80 mb-1.5">
          Letter
        </label>
        <textarea
          name="body"
          rows={8}
          maxLength={20000}
          placeholder={`Write to ${target}...`}
          className="w-full px-3 py-2 bg-black/40 border border-amber-400/20 rounded-lg text-stone-100 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        />
      </div>

      <fieldset>
        <legend className="block text-xs font-medium uppercase tracking-wider text-amber-300/80 mb-1.5">
          When can {target} open this?
        </legend>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm text-stone-200 cursor-pointer">
            <input type="radio" name="lock" checked={lockMode === 'none'} onChange={() => setLockMode('none')} />
            <span>Right away</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-200 cursor-pointer">
            <input type="radio" name="lock" checked={lockMode === 'date'} onChange={() => setLockMode('date')} />
            <Calendar size={13} className="text-amber-300/70" />
            <span>On a date:</span>
            <input
              type="date"
              value={unlockAt}
              onChange={(e) => { setUnlockAt(e.target.value); setLockMode('date') }}
              className="px-2 py-1 bg-black/40 border border-amber-400/20 rounded text-stone-100 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400/40"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-200 cursor-pointer">
            <input type="radio" name="lock" checked={lockMode === 'not-yet'} onChange={() => setLockMode('not-yet')} />
            <Lock size={13} className="text-amber-300/70" />
            <span>Not yet â€” keep it locked until I unlock it later</span>
          </label>
        </div>
      </fieldset>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
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
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
        >
          {busy ? (
            <>
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              Sendingâ€¦
            </>
          ) : (
            <>
              <Send size={13} />
              Send letter
            </>
          )}
        </button>
      </div>
    </form>
  )
}
