'use client'

// Per-row "edit" + "delete with confirm" buttons for the /admin/audit page.
// Inline confirm so the user doesn't bounce to a modal mid-list. After
// delete, refreshes the audit page in place — the row drops out and the
// next stale entry takes its place.

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { deleteEntry } from '@/lib/actions/entries'

export function AuditRowActions({ id }: { id: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  function handleDelete() {
    start(async () => {
      const r = await deleteEntry(id)
      if (!r?.error) router.refresh()
      else setConfirming(false)
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="px-2 py-1 text-xs font-medium bg-red-800 hover:bg-red-700 disabled:opacity-50 text-red-100 rounded transition"
        >
          {pending ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="px-2 py-1 text-xs text-stone-400 hover:text-stone-200 transition"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/entries/${id}/edit`}
        className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-700 transition"
        title="Edit"
      >
        <Pencil size={14} />
      </Link>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="p-1.5 rounded text-stone-500 hover:text-red-400 hover:bg-stone-700 transition"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
