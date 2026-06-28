'use client'

import { useState } from 'react'
import { Calendar, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { generateCalendarToken, clearCalendarToken } from '@/lib/actions/calendar-token'

interface Props {
  /** Existing token, if the user has already generated one. */
  existingToken: string | null
}

export function CalendarFeedSettings({ existingToken }: Props) {
  const [token, setToken] = useState<string | null>(existingToken)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const feedUrl = token
    ? (typeof window !== 'undefined' ? `${window.location.origin}` : '') + `/api/calendar/feed/${token}.ics`
    : null

  async function regenerate() {
    setBusy(true)
    setError(null)
    const res = await generateCalendarToken()
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setToken(res.token)
  }

  async function clearIt() {
    if (!confirm('Clear the calendar feed? Any device subscribed to it will stop syncing immediately.')) return
    setBusy(true)
    setError(null)
    const res = await clearCalendarToken()
    setBusy(false)
    if ('error' in res) {
      setError(res.error)
      return
    }
    setToken(null)
  }

  async function copy() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-800 border border-stone-700 shrink-0">
          <Calendar size={18} className="text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-300 leading-relaxed">
            Subscribe Google / Apple / Outlook Calendar to a private feed of all
            your dated vault entries — bill renewals, card expirations, family
            birthdays. Updates automatically as the vault changes.
          </p>
        </div>
      </div>

      {!token ? (
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow-md"
        >
          {busy ? 'Generating…' : 'Generate calendar feed URL'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-stone-700 bg-stone-900/60 p-3">
            <p className="text-[11px] text-stone-500 mb-1.5 uppercase tracking-wider">Your private feed URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-stone-200 font-mono break-all">{feedUrl}</code>
              <button
                type="button"
                onClick={copy}
                className={`p-1.5 rounded transition shrink-0 ${copied ? 'bg-emerald-900/40 text-emerald-300' : 'bg-stone-800 hover:bg-stone-700 text-stone-300'}`}
                title="Copy"
              >
                {copied ? '✓' : <Copy size={14} />}
              </button>
            </div>
          </div>
          <details className="text-xs text-stone-400">
            <summary className="cursor-pointer hover:text-stone-200">How to subscribe</summary>
            <div className="mt-2 space-y-2 pl-3">
              <p>
                <strong>Google Calendar:</strong> google.com/calendar → Other calendars → + → From URL → paste the URL above.
              </p>
              <p>
                <strong>Apple Calendar (Mac):</strong> File → New Calendar Subscription → paste URL.
              </p>
              <p>
                <strong>iPhone:</strong> Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste URL.
              </p>
              <p>
                <strong>Outlook:</strong> outlook.live.com → Calendar → Add → Subscribe from web → paste URL.
              </p>
            </div>
          </details>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 disabled:opacity-50 border border-stone-700 text-stone-300 rounded-lg transition"
            >
              <RefreshCw size={11} />
              Regenerate
            </button>
            <button
              type="button"
              onClick={clearIt}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-red-950/40 hover:border-red-700/40 disabled:opacity-50 border border-stone-700 text-stone-400 hover:text-red-300 rounded-lg transition"
            >
              <Trash2 size={11} />
              Clear feed
            </button>
            <span className="text-[11px] text-stone-500">
              Regenerating invalidates the old URL — anything subscribed to it stops syncing.
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
