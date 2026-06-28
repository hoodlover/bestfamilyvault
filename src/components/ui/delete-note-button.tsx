'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteNote } from '@/lib/actions/entries'

export function DeleteNoteButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    setLoading(true)
    await deleteNote(id)
    router.push('/notes')
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-stone-400">Are you sure?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-red-200 text-sm rounded-lg transition disabled:opacity-50"
        >
          {loading ? 'Deleting...' : 'Delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-sm rounded-lg transition"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-red-900/40 border border-stone-700 hover:border-red-800/50 text-stone-400 hover:text-red-400 text-sm rounded-lg transition"
    >
      <Trash2 size={13} />
      Delete
    </button>
  )
}
