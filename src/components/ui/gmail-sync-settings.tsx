'use client'

// Gmail sync controls for the settings page. When the user hasn't linked
// Gmail yet, shows a Connect button that kicks off the OAuth flow at
// /api/google/connect/start. When connected, shows the linked email,
// frequency picker, last-synced timestamp, Sync now, and Disconnect.

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, ChevronDown, Mail, RefreshCw, Trash2, Unlink } from 'lucide-react'
import {
  disconnectGmail,
  setGmailSyncFrequency,
  triggerSyncNow,
} from '@/lib/actions/gmail-contacts'

interface Props {
  linked: boolean
  gmailEmail: string | null
  syncFrequency: string
  lastSyncedAt: Date | null
}

const FREQUENCIES: Array<{ value: 'manual' | 'hourly' | 'daily' | 'weekly'; label: string }> = [
  { value: 'manual', label: 'Manual only' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

export function GmailSyncSettings({ linked, gmailEmail, syncFrequency, lastSyncedAt }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read query string flags from /api/google/connect/callback
  const linkError = params.get('gmailLinkError')
  const justLinked = params.get('gmailLinked') === '1'

  async function changeFreq(value: 'manual' | 'hourly' | 'daily' | 'weekly') {
    setBusy(true)
    await setGmailSyncFrequency(value)
    setBusy(false)
    startTransition(() => router.refresh())
  }

  async function syncNow() {
    setBusy(true)
    setError(null)
    setMessage(null)
    const res = await triggerSyncNow()
    setBusy(false)
    if ('error' in res && res.error) {
      setError(res.error)
    } else if ('outcome' in res && res.outcome) {
      const o = res.outcome
      const total = o.pushedCreated + o.pushedUpdated + o.pushedDeleted + o.pulledUpserted + o.pulledDeleted
      setMessage(total === 0 ? 'Up to date.' : `Synced — pushed ${o.pushedCreated + o.pushedUpdated + o.pushedDeleted}, pulled ${o.pulledUpserted + o.pulledDeleted}.`)
      startTransition(() => router.refresh())
    }
  }

  async function disconnect(wipeContacts: boolean) {
    if (!confirm(wipeContacts
      ? 'Disconnect Gmail AND remove all imported contacts from the vault? Your Gmail address book is not affected.'
      : 'Disconnect Gmail (keep the imported contacts in the vault as a snapshot)?')) return
    setBusy(true)
    await disconnectGmail({ wipeContacts })
    setBusy(false)
    setMessage('Gmail disconnected.')
    startTransition(() => router.refresh())
  }

  if (!linked) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-stone-700/60 bg-stone-800/40 p-4 space-y-2">
          <p className="text-sm text-stone-300">
            Link your Gmail to import your address book into the vault — and keep changes
            syncing both ways. Each family member has their own private list; nothing is shared.
          </p>
          <a
            href="/api/google/connect/start"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-md"
          >
            <Mail size={14} />
            Connect Gmail
          </a>
        </div>
        {linkError && (
          <p className="text-xs text-red-400">
            Couldn&rsquo;t link Gmail ({linkError}). Try again — make sure you allow the
            Contacts permission.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-stone-700/60 bg-stone-800/40 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-stone-100 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-emerald-400" />
            Connected to <span className="text-emerald-300">{gmailEmail}</span>
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            {lastSyncedAt ? <>Last synced {formatTime(lastSyncedAt)}</> : 'Not synced yet — tap Sync now to import.'}
          </p>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-stone-500 mb-1">
          Auto-sync frequency
        </label>
        <div className="relative">
          <select
            value={syncFrequency}
            onChange={(e) => changeFreq(e.target.value as 'manual' | 'hourly' | 'daily' | 'weekly')}
            disabled={busy}
            className="w-full pl-3 pr-9 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
        </div>
        <p className="text-[11px] text-stone-500 mt-1">
          Manual = only syncs when you tap Sync now. Otherwise the cron sweeps through eligible
          accounts hourly and runs anyone whose interval has elapsed.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-stone-800">
        <button
          type="button"
          onClick={() => disconnect(false)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 rounded-lg transition disabled:opacity-60"
        >
          <Unlink size={12} />
          Disconnect (keep contacts)
        </button>
        <button
          type="button"
          onClick={() => disconnect(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-red-900/40 border border-stone-700 hover:border-red-700/50 text-stone-300 hover:text-red-300 rounded-lg transition disabled:opacity-60"
        >
          <Trash2 size={12} />
          Disconnect + wipe contacts
        </button>
      </div>

      {(justLinked || message) && (
        <p className="text-xs text-emerald-300">{justLinked ? 'Gmail linked. Tap Sync now to import.' : message}</p>
      )}
      {(linkError || error) && (
        <p className="text-xs text-red-400">{error ?? `Couldn’t link Gmail (${linkError}).`}</p>
      )}
    </div>
  )
}

function formatTime(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}
