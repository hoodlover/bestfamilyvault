'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { revokeInvite, deleteInvite } from '@/lib/actions/admin'
import { clsx } from 'clsx'

const statusBadge: Record<string, string> = {
  pending: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50',
  accepted: 'bg-green-900/40 text-green-400 border-green-800/50',
  expired: 'bg-stone-700/40 text-stone-500 border-stone-600/50',
}

interface InviteRowProps {
  invite: {
    id: string
    email: string
    role: string
    status: string
    expiresAt: Date
  }
}

export function InviteRow({ invite }: InviteRowProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRevoke() {
    setLoading(true)
    await revokeInvite(invite.id)
    setLoading(false)
    router.refresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete this invite for ${invite.email}?`)) return
    setLoading(true)
    await deleteInvite(invite.id)
    setLoading(false)
    router.refresh()
  }

  return (
    <tr className="border-b border-stone-700/30 last:border-0">
      <td className="px-5 py-3.5 text-sm text-stone-300">{invite.email}</td>
      <td className="px-5 py-3.5">
        <span className="text-xs text-stone-500 capitalize">{invite.role}</span>
      </td>
      <td className="px-5 py-3.5">
        <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border capitalize', statusBadge[invite.status])}>
          {invite.status}
        </span>
      </td>
      <td className="px-5 py-3.5 text-xs text-stone-500">
        {new Date(invite.expiresAt).toLocaleDateString()}
      </td>
      <td className="px-5 py-3.5 text-right">
        <div className="flex items-center gap-1 justify-end">
          {invite.status === 'pending' && (
            <button
              onClick={handleRevoke}
              disabled={loading}
              className="text-xs text-stone-600 hover:text-yellow-400 transition px-2 py-1 rounded-lg hover:bg-stone-700 disabled:opacity-50"
            >
              Revoke
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={loading}
            className="text-xs text-stone-600 hover:text-red-400 transition px-2 py-1 rounded-lg hover:bg-stone-700 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}
