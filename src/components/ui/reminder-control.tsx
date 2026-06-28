'use client'

// "Remind me" control — drop-in for any parent that wants the user to be
// able to schedule a web-push reminder tied to that parent (note or
// todo list). Renders the list of pending reminders + a small datetime
// picker that creates a new one. Existing pending reminders can be
// cancelled inline.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellPlus, X } from 'lucide-react'
import { createReminder, cancelReminder } from '@/lib/actions/reminders'

export interface ReminderRow {
  id: string
  title: string
  body: string | null
  remindAt: Date | string
  sentAt: Date | string | null
}

interface Props {
  // Exactly one of these is set — drives which parent the reminder
  // attaches to. Title default comes from the parent's title.
  noteId?: string
  todoListId?: string
  defaultTitle: string
  initialReminders: ReminderRow[]
}

export function ReminderControl({ noteId, todoListId, defaultTitle, initialReminders }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState(defaultTitle)
  const [remindAt, setRemindAt] = useState<string>(defaultDatetime())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Split pending vs sent so the "fired in the past" rows don't pile up
  // alongside upcoming ones. Sent reminders are kept around for a few
  // days for context ("yes the system pinged me about this Tuesday"),
  // greyed out — anything older than that is hidden client-side here
  // and hard-deleted by the process-reminders cron sweep so the panel
  // doesn't accumulate weeks of crossed-off rows.
  const sentCutoffMs = Date.now() - 3 * 24 * 60 * 60 * 1000
  const pending = initialReminders.filter((r) => !r.sentAt)
  const sent = initialReminders.filter((r) => {
    if (!r.sentAt) return false
    const sentAtMs = (r.sentAt instanceof Date ? r.sentAt : new Date(r.sentAt)).getTime()
    return Number.isFinite(sentAtMs) && sentAtMs >= sentCutoffMs
  })

  async function submit() {
    setBusy(true)
    setError(null)
    // datetime-local hands us a tz-less string like "2026-06-16T00:01".
    // The browser's `new Date(...)` parses that as LOCAL time (which is
    // what the user picked) — but on Vercel the server runs in UTC, so
    // server-side parsing of the same string interprets it as UTC, which
    // is hours off from what the user meant (and often "in the past").
    // Convert to a real UTC ISO here so the server gets an unambiguous
    // instant.
    const localDate = new Date(remindAt)
    if (isNaN(localDate.getTime())) {
      setBusy(false)
      setError('Invalid date.')
      return
    }
    const res = await createReminder({
      title,
      remindAt: localDate.toISOString(),
      noteId,
      todoListId,
    })
    setBusy(false)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setAdding(false)
    setTitle(defaultTitle)
    setRemindAt(defaultDatetime())
    startTransition(() => router.refresh())
  }

  async function cancel(id: string) {
    setBusy(true)
    await cancelReminder(id)
    setBusy(false)
    startTransition(() => router.refresh())
  }

  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
          <Bell size={14} className="text-amber-400" />
          Reminders
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md text-amber-200 bg-amber-950/40 border border-amber-800/40 hover:bg-amber-900/40 transition"
          >
            <BellPlus size={12} />
            Add
          </button>
        )}
      </div>

      {pending.length === 0 && sent.length === 0 && !adding && (
        <p className="text-xs text-stone-500">No reminders set.</p>
      )}

      {pending.length > 0 && (
        <ul className="space-y-1.5">
          {pending.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-md bg-stone-800/60 border border-stone-700/50">
              <div className="flex-1 min-w-0">
                <div className="text-stone-200 truncate">{r.title}</div>
                <div className="text-stone-500">{formatWhen(r.remindAt)}</div>
              </div>
              <button
                type="button"
                onClick={() => cancel(r.id)}
                disabled={busy}
                aria-label="Cancel reminder"
                title="Cancel reminder"
                className="p-1 text-stone-500 hover:text-red-400 transition"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {sent.length > 0 && (
        <ul className="space-y-1.5 opacity-60">
          {sent.slice(0, 3).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-md bg-stone-800/40 border border-stone-700/30">
              <div className="flex-1 min-w-0">
                <div className="text-stone-300 truncate line-through">{r.title}</div>
                <div className="text-stone-500">sent {formatWhen(r.sentAt!)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Reminder title"
            className="w-full px-2.5 py-1.5 bg-stone-800 border border-stone-700 rounded-md text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600/50"
          />
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-stone-800 border border-stone-700 rounded-md text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600/50"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy || !title.trim() || !remindAt}
              className="flex-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500 text-white text-xs font-semibold rounded-md transition"
            >
              {busy ? 'Saving…' : 'Set reminder'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(null); setTitle(defaultTitle); setRemindAt(defaultDatetime()) }}
              className="px-3 py-1.5 text-stone-400 hover:text-stone-200 text-xs transition"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-stone-500">
            You&apos;ll get a push notification — enable notifications in Settings if you haven&apos;t already.
          </p>
        </div>
      )}
    </div>
  )
}

function formatWhen(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Default the picker to "an hour from now" rounded to the next 15-min
// boundary so the input shows something useful out of the box rather
// than the current minute. Format must be YYYY-MM-DDTHH:MM for the
// datetime-local input.
function defaultDatetime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  const min = d.getMinutes()
  const rounded = Math.ceil(min / 15) * 15
  d.setMinutes(rounded, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
