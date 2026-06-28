'use client'

// Standalone capsule-create form — used at /capsules/new. Was originally
// an in-place modal on /capsules but the modal rendering had reliability
// issues on at least one device, so the form lives at its own route now.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Send, Users } from 'lucide-react'
import { createCapsule } from '@/lib/actions/time-capsules'
import { useUnsavedGuard } from './use-unsaved-guard'

interface FamilyOption { id: string; name: string | null; email: string | null }

interface Props {
  family: FamilyOption[]
  currentUserId: string
}

export function NewCapsuleForm({ family, currentUserId }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [toUserId, setToUserId] = useState<string>(currentUserId)
  const [unlockAt, setUnlockAt] = useState<string>(() => {
    // Default unlock: one year from today.
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { dirty, markDirty, markClean } = useUnsavedGuard()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!title.trim()) { setError('Pick a title.'); return }
    if (!unlockAt) { setError('Pick an unlock date.'); return }

    setBusy(true)
    const fd = new FormData()
    fd.append('title', title.trim())
    fd.append('body', body)
    fd.append('toUserId', toUserId)
    // Convert YYYY-MM-DD into a Date with a midday-local-time timestamp so
    // unlocks don't surprise people overnight.
    const d = new Date(unlockAt + 'T12:00:00')
    fd.append('unlockAt', d.toISOString())
    const res = await createCapsule(fd)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    markClean()
    router.push('/capsules')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5" onChange={markDirty}>
      {dirty && (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-0 px-3 py-1.5 text-xs text-amber-200 bg-amber-950/40 border-y md:border md:rounded-md border-amber-700/40 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Not saved yet — tap Save when you&rsquo;re done.
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">To</label>
        <div className="relative">
          <Users size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
          <select
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            disabled={busy}
            className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          >
            <option value="all">— All family —</option>
            {family.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id === currentUserId
                  ? `Future ${f.name?.split(' ')[0] ?? 'me'} (yourself)`
                  : (f.name ?? f.email ?? f.id)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Title *</label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="What's this about?"
          disabled={busy}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          maxLength={50_000}
          placeholder="Whatever you want to say. They'll read it on the unlock date."
          disabled={busy}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-y"
        />
        <p className="mt-1 text-[11px] text-stone-600 text-right">{body.length.toLocaleString()} / 50,000</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Unlock date</label>
        <input
          type="date"
          value={unlockAt}
          onChange={(e) => setUnlockAt(e.target.value)}
          disabled={busy}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        />
        <p className="mt-1 text-[11px] text-stone-500">
          {unlockAt && (() => {
            const d = new Date(unlockAt + 'T12:00:00')
            // Can't combine dateStyle with weekday — RangeError. Use components.
            return `Unlocks ${formatRelative(d)} on ${d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          })()}
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Link
          href="/capsules"
          className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={busy || !title.trim() || !unlockAt}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:opacity-60 text-white rounded-lg transition"
        >
          {busy ? (
            <>
              <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              Sealing…
            </>
          ) : (
            <>
              <Send size={13} />
              Seal capsule
            </>
          )}
        </button>
      </div>
    </form>
  )
}

function formatRelative(target: Date): string {
  const ms = target.getTime() - Date.now()
  const days = Math.abs(ms) / 86_400_000
  if (days < 1) return 'within the day'
  if (days < 30) return `in ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  const months = days / 30.44
  if (months < 12) return `in ${Math.round(months)} month${Math.round(months) === 1 ? '' : 's'}`
  const years = days / 365.25
  const y = years < 2 ? years.toFixed(1) : Math.round(years).toString()
  return `in ${y} year${y === '1' || y === '1.0' ? '' : 's'}`
}
