'use client'

// "Mark handled" button on overdue rows in /calendar. One tap → server
// advances subscriptionRenewsAt by one period (monthly/yearly), the page
// revalidates, the row leaves Overdue and shows up under the next bucket
// it now fits into.
//
// Stops both default + propagation on the click so the surrounding Link
// to /entries/<id> doesn't fire too.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { advanceEntryRenewal } from '@/lib/actions/entries'

interface Props {
  entryId: string
  period: string | null
}

export function MarkHandledButton({ entryId, period }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justDone, setJustDone] = useState(false)

  // one_time bills don't roll forward — server rejects the call too, but
  // hiding the button up front keeps the affordance honest.
  if (period === 'one_time') return null

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await advanceEntryRenewal(entryId)
    setBusy(false)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setJustDone(true)
    // Refresh after a brief beat so the green confirm flash is visible
    // before the row jumps out of the Overdue bucket.
    setTimeout(() => startTransition(() => router.refresh()), 400)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={error ?? `Mark handled — bump renewal +1 ${period === 'yearly' ? 'year' : 'month'}`}
      aria-label="Mark handled"
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition ${
        justDone
          ? 'border-emerald-700/50 bg-emerald-900/40 text-emerald-200'
          : error
            ? 'border-red-700/50 bg-red-900/30 text-red-200'
            : 'border-emerald-700/40 bg-stone-900/60 text-emerald-300 hover:bg-emerald-900/30'
      }`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      {justDone ? 'Done' : busy ? 'Bumping…' : 'Mark handled'}
    </button>
  )
}
