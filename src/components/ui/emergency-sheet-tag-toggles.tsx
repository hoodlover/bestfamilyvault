'use client'

import { useState, useTransition } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { toggleEmergencySheetTag } from '@/lib/actions/emergency-sheet'

interface LoginRow {
  id: string
  title: string
  username: string | null
  url: string | null
  included: boolean
}

interface Props {
  logins: LoginRow[]
}

export function EmergencySheetTagToggles({ logins }: Props) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(logins.map((l) => [l.id, l.included])),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleToggle(id: string) {
    const next = !state[id]
    // Optimistic — flip the local state immediately; revert on error.
    setState((prev) => ({ ...prev, [id]: next }))
    setBusyId(id)
    setError(null)
    startTransition(async () => {
      const res = await toggleEmergencySheetTag(id, next)
      setBusyId(null)
      if ('error' in res && res.error) {
        setError(res.error)
        setState((prev) => ({ ...prev, [id]: !next }))
      }
    })
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {logins.map((login) => {
        const included = state[login.id]
        return (
          <button
            key={login.id}
            type="button"
            onClick={() => handleToggle(login.id)}
            disabled={busyId === login.id}
            className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
              included
                ? 'border-emerald-700/50 bg-emerald-950/30 hover:bg-emerald-950/50'
                : 'border-stone-800 bg-stone-900/40 hover:bg-stone-900/70'
            } disabled:opacity-60`}
          >
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-md border shrink-0 ${
                included
                  ? 'border-emerald-500 bg-emerald-600 text-white'
                  : 'border-stone-600 bg-stone-800 text-stone-500'
              }`}
            >
              {busyId === login.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : included ? (
                <Check size={14} />
              ) : (
                <X size={12} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-stone-100 truncate">{login.title}</div>
              <div className="text-xs text-stone-400 truncate">
                {login.username ?? '(no username)'}
                {login.url ? ` · ${login.url}` : ''}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
