'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteEntry } from '@/lib/actions/entries'

export function DeleteEntryButton({ id, categorySlug }: { id: string; categorySlug?: string }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setLoading(true)
    await deleteEntry(id)
    router.push(categorySlug ? `/categories/${categorySlug}` : '/dashboard')
    router.refresh()
  }

  if (confirming) {
    // Confirm state is compact on mobile too — "Sure?" instead of the
    // long "Are you sure?" so the row still fits on one line next to
    // Recurring + Edit. Cancel is icon-only on small screens.
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-stone-400 hidden md:inline">Are you sure?</span>
        <span className="text-xs text-stone-400 md:hidden">Sure?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          aria-label="Confirm delete"
          className="px-2.5 py-1.5 bg-red-800 hover:bg-red-700 text-red-200 text-sm rounded-lg transition disabled:opacity-50"
        >
          {loading ? '…' : <span><span className="hidden md:inline">Delete</span><span className="md:hidden">Yes</span></span>}
        </button>
        <button
          onClick={() => setConfirming(false)}
          aria-label="Cancel"
          className="px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm rounded-lg transition"
        >
          <span className="hidden md:inline">Cancel</span>
          <span className="md:hidden">No</span>
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label="Delete"
      className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-red-900/40 border border-stone-700 hover:border-red-800/50 text-stone-400 hover:text-red-400 text-sm rounded-lg transition"
    >
      <Trash2 size={13} />
      <span className="hidden md:inline">Delete</span>
    </button>
  )
}
