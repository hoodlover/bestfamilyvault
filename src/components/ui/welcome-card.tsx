'use client'

// First-run welcome card on /dashboard. Shows for any signed-in user who
// hasn't created any entries or notes yet — most useful for a brand-new
// family member who lands cold and doesn't know where to start. Once
// they dismiss it (or add their first thing), it stays gone.
//
// Dismissal is tracked in localStorage per user so it doesn't follow them
// across accounts on a shared computer.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { KeyRound, Receipt, Upload, X } from 'lucide-react'

interface Props {
  userId: string
  firstName: string
}

export function WelcomeCard({ userId, firstName }: Props) {
  const storageKey = `bestfamilyvault.welcome-dismissed.${userId}`
  // Default to hidden until we've checked localStorage; otherwise the
  // card flashes for everyone on every reload before being hidden again.
  const [show, setShow] = useState(false)

  useEffect(() => {
    // localStorage is an external read — there's no derived-state shortcut
    // and the SSR pass can't see it, so we read on mount and commit. The
    // lint rule flags setState-in-effect to catch cascading-render bugs;
    // this is a one-shot read, so the warning is a false positive here.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(storageKey) !== '1') setShow(true)
    } catch {
      setShow(true)
    }
  }, [storageKey])

  function dismiss() {
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      /* private browsing — just hide locally */
    }
    setShow(false)
  }

  if (!show) return null

  return (
    <section className="mb-6 rounded-2xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950/40 via-stone-900/40 to-stone-900/60 p-5 relative">
      <button
        type="button"
        onClick={dismiss}
        className="absolute top-3 right-3 p-1.5 text-stone-500 hover:text-stone-200 rounded-full hover:bg-stone-800/60 transition"
        aria-label="Dismiss welcome card"
      >
        <X size={15} />
      </button>

      <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-400 font-semibold mb-2">
        Welcome to the vault
      </p>
      <h2 className="text-lg font-bold text-stone-100 mb-1">
        Hi, {firstName} — here&rsquo;s where each thing goes.
      </h2>
      <p className="text-sm text-stone-400 mb-4">
        Tap one of these tiles up top to add your first thing. The same icons live in the action grid below — no rush.
      </p>

      <ul className="space-y-2.5 text-sm">
        <li className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-950/40 ring-1 ring-amber-700/40 text-amber-300">
            <KeyRound size={16} />
          </span>
          <span className="min-w-0">
            <strong className="text-stone-100">Add</strong>
            <span className="text-stone-400"> — passwords, notes, bank accounts, credit cards, IDs. The vault&rsquo;s bread and butter.</span>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-950/40 ring-1 ring-sky-700/40 text-sky-300">
            <Upload size={16} />
          </span>
          <span className="min-w-0">
            <strong className="text-stone-100">Upload</strong>
            <span className="text-stone-400"> — any document or photo: insurance card, deed, kid&rsquo;s drawing. Goes wherever you file it.</span>
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-950/40 ring-1 ring-emerald-700/40 text-emerald-300">
            <Receipt size={16} />
          </span>
          <span className="min-w-0">
            <strong className="text-stone-100">Receipt</strong>
            <span className="text-stone-400"> — snap one (or 15), Claude reads merchant + total + date, files them under the best-fit category. Original photo always kept.</span>
          </span>
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/guide"
          className="text-xs text-emerald-300 hover:text-emerald-200 underline decoration-emerald-500/40 hover:decoration-emerald-300 transition"
        >
          Five-minute guide →
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="px-3 py-1.5 text-xs font-medium text-stone-300 hover:text-stone-100 bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700 rounded-lg transition"
        >
          Got it
        </button>
      </div>
    </section>
  )
}
