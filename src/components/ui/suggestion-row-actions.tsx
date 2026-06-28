'use client'

// Approve / Dismiss buttons for a row in the Suggested tab on
// /subscriptions. Lives client-side so the action can show inline
// pending/error state; the server actions revalidate the path so the
// row disappears on success.

import { useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import {
  approveRecurringSuggestion,
  dismissRecurringSuggestion,
} from '@/lib/actions/recurring-suggestions'

export function SuggestionRowActions({ suggestionId }: { suggestionId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function approve() {
    setError(null)
    startTransition(async () => {
      const r = await approveRecurringSuggestion(suggestionId)
      if (r.error) setError(r.error)
    })
  }

  function dismiss() {
    setError(null)
    startTransition(async () => {
      const r = await dismissRecurringSuggestion(suggestionId)
      if (r.error) setError(r.error)
    })
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={approve}
        disabled={pending}
        title="Add to recurring"
        aria-label="Add to recurring"
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-green-400 bg-green-500/20 hover:bg-green-500/35 disabled:opacity-50 text-green-300 transition"
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        title="Dismiss"
        aria-label="Dismiss"
        className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-400 hover:text-stone-200 transition"
      >
        <X size={14} />
      </button>
      {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
    </div>
  )
}
