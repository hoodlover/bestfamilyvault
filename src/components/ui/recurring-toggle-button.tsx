'use client'

// Mark / unmark an entry as a recurring bill. Shown on the entry detail
// page; clicking it flips the is_recurring flag on the entry without
// moving it from its category. The /subscriptions page filters on this
// flag instead of looking at subcategory, so a Netflix login can stay
// filed under Entertainment AND show up as a recurring charge.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Repeat } from 'lucide-react'
import { clsx } from 'clsx'
import { setEntryRecurring } from '@/lib/actions/entries'

export function RecurringToggleButton({
  entryId,
  initialRecurring,
}: {
  entryId: string
  initialRecurring: boolean
}) {
  const router = useRouter()
  const [recurring, setRecurring] = useState(initialRecurring)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !recurring
    setRecurring(next) // optimistic
    startTransition(async () => {
      const r = await setEntryRecurring(entryId, next)
      if (r?.error) {
        // rollback if the server rejected
        setRecurring(!next)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={recurring
        ? 'On the recurring-bills list. Tap to remove (entry stays put).'
        : 'Add this entry to the recurring-bills list. It stays in its current category.'}
      className={clsx(
        'inline-flex items-center gap-1.5 text-sm rounded-lg transition disabled:opacity-50',
        recurring
          // On-state matches the global bright-green confirm style used by
          // Save buttons across the app (contacts editor, settings, etc.) —
          // border-green-400 + green-500/25 fill + green-500/50 glow.
          ? 'px-4 py-2 font-semibold border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 shadow-lg shadow-green-500/50 text-white'
          // Off-state stays neutral so it reads as "not yet on the list."
          : 'px-3 py-1.5 border bg-stone-800 hover:bg-stone-700 border-stone-700 text-stone-300 hover:text-stone-100',
      )}
    >
      <Repeat size={13} />
      <span className="hidden md:inline">
        {recurring ? 'Recurring bill' : 'Mark as recurring'}
      </span>
    </button>
  )
}
