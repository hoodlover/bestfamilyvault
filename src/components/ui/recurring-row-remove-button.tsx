'use client'

// Removes an entry from the /subscriptions list by clearing its
// is_recurring flag. The entry itself is NOT deleted — it stays in
// whatever category it's filed under. Different from delete on purpose:
// the goal is to stop tracking it as a recurring bill, not to lose
// the login info.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { setEntryRecurring } from '@/lib/actions/entries'

export function RecurringRowRemoveButton({ entryId, title }: { entryId: string; title: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function remove(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    startTransition(async () => {
      await setEntryRecurring(entryId, false)
      router.refresh()
    })
  }

  if (confirming) {
    return (
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="px-2 py-1 text-xs font-medium bg-red-800 hover:bg-red-700 disabled:opacity-50 text-red-100 rounded transition"
        >
          {pending ? 'Removing…' : 'Remove'}
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(false) }}
          disabled={pending}
          className="px-2 py-1 text-xs text-stone-400 hover:text-stone-200 transition"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
      title={`Remove "${title}" from the recurring-bills list (the entry itself stays put)`}
      aria-label="Remove from recurring bills"
      className="p-1.5 rounded text-stone-500 hover:text-amber-400 hover:bg-stone-700 transition shrink-0"
    >
      <X size={14} />
    </button>
  )
}
