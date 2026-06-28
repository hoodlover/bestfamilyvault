'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { approveUpgradeRequest, dismissUpgradeRequest } from '@/lib/actions/upgrade-requests'

interface Props {
  request: {
    id: string
    message: string
    requestedRole: 'superuser' | 'admin' | 'member' | 'readonly' | null
    createdAt: Date
    userId: string
    userName: string | null
    userEmail: string | null
    userRole: string | null
    userImage: string | null
  }
  isSuperuser: boolean
}

const ASSIGNABLE_ROLES = ['readonly', 'member', 'admin'] as const

export function UpgradeRequestRow({ request, isSuperuser }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [chosenRole, setChosenRole] = useState<string>(
    request.requestedRole && request.requestedRole !== 'superuser' ? request.requestedRole : 'member'
  )

  function approve() {
    setError(null)
    startTransition(async () => {
      const result = await approveUpgradeRequest(
        request.id,
        chosenRole as 'admin' | 'member' | 'readonly'
      )
      if (result?.error) setError(result.error)
      else router.refresh()
    })
  }

  function dismiss() {
    setError(null)
    startTransition(async () => {
      await dismissUpgradeRequest(request.id)
      router.refresh()
    })
  }

  const initial = (request.userName ?? request.userEmail ?? '?').trim().charAt(0).toUpperCase() || '?'
  const ts = new Date(request.createdAt).toLocaleString()

  return (
    <div className="p-4 bg-stone-800/40 border border-amber-700/30 rounded-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-stone-700 border border-stone-600">
          {request.userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.userImage} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-stone-200">{initial}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-stone-100 truncate">
              {request.userName ?? request.userEmail ?? 'Unknown'}
            </span>
            <span className="text-xs text-stone-500">currently</span>
            <span className="text-xs uppercase tracking-wider text-stone-300">{request.userRole ?? '—'}</span>
            {request.requestedRole && (
              <>
                <span className="text-xs text-stone-500">→ wants</span>
                <span className="text-xs uppercase tracking-wider text-emerald-300">{request.requestedRole}</span>
              </>
            )}
          </div>
          <p className="mt-2 text-sm text-stone-300 whitespace-pre-wrap">{request.message}</p>
          <p className="mt-2 text-xs text-stone-500">{ts}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <select
          value={chosenRole}
          onChange={(e) => setChosenRole(e.target.value)}
          disabled={pending}
          className="px-2 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-200 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
        >
          {ASSIGNABLE_ROLES.filter((r) => r !== 'admin' || isSuperuser).map((r) => (
            <option key={r} value={r}>set role: {r}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white text-xs font-medium rounded-lg transition"
        >
          <Check size={13} />
          Approve
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium rounded-lg transition border border-stone-700"
        >
          <X size={13} />
          Dismiss
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
