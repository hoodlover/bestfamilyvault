'use client'

// Client UI for /capsules — list + view modal. The "New capsule" flow lives
// at /capsules/new (its own page) because the inline modal had reliability
// issues on at least one device. Read-only listing + open-to-view on this page.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Hourglass, Lock, Mail, Plus, X, Sparkles, Trash2 } from 'lucide-react'
import { HelpPopout } from './help-popout'
import {
  listCapsules, viewCapsule, cancelCapsule,
  type CapsuleListItem, type CapsuleViewResult,
} from '@/lib/actions/time-capsules'

interface FamilyOption { id: string; name: string | null; email: string | null }

interface Props {
  family: FamilyOption[]
  initialCapsules: CapsuleListItem[]
  currentUserId: string
  /** Set when the server-side listCapsules() throws — page still renders so
   *  the user can at least try a fresh "New capsule," but with the error on
   *  display so they (or Lance) can fix it. */
  loadError?: string | null
}

export function TimeCapsulesPage({ family: _family, initialCapsules, currentUserId: _currentUserId, loadError }: Props) {
  const [capsules, setCapsules] = useState<CapsuleListItem[]>(initialCapsules)
  const [viewing, setViewing] = useState<CapsuleListItem | null>(null)

  async function refresh() {
    const fresh = await listCapsules()
    setCapsules(fresh)
  }

  // Group: sealed-for-me, unlocked-for-me, sent-by-me-still-sealed, sent-by-me-already-unlocked
  const sections = useMemo(() => {
    const sealedIncoming: CapsuleListItem[] = []
    const unlockedIncoming: CapsuleListItem[] = []
    const sealedSent: CapsuleListItem[] = []
    const unlockedSent: CapsuleListItem[] = []
    for (const c of capsules) {
      if (c.isForMe && !c.isMine) {
        if (c.isUnlocked) unlockedIncoming.push(c)
        else sealedIncoming.push(c)
      } else if (c.isMine) {
        if (c.isUnlocked) unlockedSent.push(c)
        else sealedSent.push(c)
      }
    }
    // Most recent first within each section
    sealedIncoming.sort((a, b) => a.unlockAt.localeCompare(b.unlockAt))
    sealedSent.sort((a, b) => a.unlockAt.localeCompare(b.unlockAt))
    unlockedIncoming.sort((a, b) => b.unlockAt.localeCompare(a.unlockAt))
    unlockedSent.sort((a, b) => b.unlockAt.localeCompare(a.unlockAt))
    return { sealedIncoming, unlockedIncoming, sealedSent, unlockedSent }
  }, [capsules])

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {loadError && (
        <div className="mb-5 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
          <p className="font-medium text-amber-200">Couldn&rsquo;t load capsules.</p>
          <p className="mt-1 text-amber-100/80 text-xs leading-relaxed">
            If you just deployed a schema change, run{' '}
            <code className="bg-stone-900/60 px-1.5 py-0.5 rounded text-amber-200">npm run db:push</code>{' '}
            so the time_capsule table exists. Otherwise tell Lance the
            error message below and he&rsquo;ll dig in. You can still try
            creating a fresh capsule.
          </p>
          <p className="mt-2 text-[11px] font-mono text-amber-200/70 break-words">
            {loadError}
          </p>
        </div>
      )}
      <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-stone-100">
            <Hourglass size={22} className="text-amber-400" />
            Time Capsules
            <HelpPopout
              title="Time Capsules"
              sections={[
                {
                  heading: 'What this is',
                  tips: [
                    { title: 'Sealed notes', description: 'Write a note today, pick an unlock date — the vault keeps it encrypted and hidden until that date arrives.' },
                    { title: 'For yourself or others', description: 'Address to yourself ("future me, in 5 years"), a specific family member, or "all family" (anyone unlocks after the date).' },
                  ],
                },
                {
                  heading: 'Create + release',
                  tips: [
                    { title: 'Compose', description: '+ New capsule. Title, body, optional attachments. Pick unlock date.' },
                    { title: 'Sealed = encrypted', description: 'Body is AES-encrypted at rest. Even an admin reading the DB can\'t peek before the date.' },
                    { title: 'Release', description: 'On unlock date, recipient (or any family member if "all") sees the contents. Sender can also force-release early from the detail view.' },
                  ],
                },
              ]}
            />
          </h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Write a sealed note today. The vault keeps it locked until the date you pick.
          </p>
        </div>
        <Link
          href="/capsules/new"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          <Plus size={14} />
          New capsule
        </Link>
      </header>

      {capsules.length === 0 && (
        <div className="text-center py-16 text-stone-500 border border-stone-800 rounded-xl">
          <Sparkles size={28} className="mx-auto text-amber-400/60 mb-3" />
          <p className="font-medium text-stone-400">Nothing sealed yet.</p>
          <p className="text-sm mt-1">Write your first capsule — to a future you, or to someone you love.</p>
        </div>
      )}

      <Section title="Ready to open" emoji="🔓" items={sections.unlockedIncoming} onView={setViewing} variant="unlocked" />
      <Section title="Sealed (waiting for you)" emoji="🔒" items={sections.sealedIncoming} onView={setViewing} variant="sealed" />
      <Section title="Sent by you · still sealed" emoji="📦" items={sections.sealedSent} onView={setViewing} variant="sealed-mine" />
      <Section title="Sent by you · already unlocked" emoji="📬" items={sections.unlockedSent} onView={setViewing} variant="unlocked" />

      {viewing && (
        <ViewCapsuleModal
          capsuleListItem={viewing}
          onClose={() => setViewing(null)}
          onCancel={async () => { setViewing(null); await refresh() }}
        />
      )}
    </div>
  )
}

function Section({
  title, emoji, items, onView, variant,
}: {
  title: string
  emoji: string
  items: CapsuleListItem[]
  onView: (c: CapsuleListItem) => void
  variant: 'sealed' | 'unlocked' | 'sealed-mine'
}) {
  if (items.length === 0) return null
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-2">
        <span>{emoji}</span> {title} <span className="text-stone-600 font-normal">({items.length})</span>
      </h2>
      <div className="space-y-2">
        {items.map((c) => (
          <Card key={c.id} c={c} onView={onView} variant={variant} />
        ))}
      </div>
    </section>
  )
}

function Card({
  c, onView, variant,
}: {
  c: CapsuleListItem
  onView: (c: CapsuleListItem) => void
  variant: 'sealed' | 'unlocked' | 'sealed-mine'
}) {
  const unlockDate = new Date(c.unlockAt)
  const sealedFor = formatRelative(unlockDate)
  return (
    <button
      type="button"
      onClick={() => onView(c)}
      className={`w-full text-left rounded-xl border p-4 transition ${
        variant === 'unlocked'
          ? 'bg-emerald-950/20 border-emerald-700/40 hover:border-emerald-600/60'
          : variant === 'sealed-mine'
          ? 'bg-stone-800/40 border-stone-700/50 hover:border-stone-600'
          : 'bg-amber-950/15 border-amber-700/30 hover:border-amber-600/50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {variant === 'unlocked' ? (
            <Mail size={15} className="text-emerald-300 shrink-0" />
          ) : (
            <Lock size={14} className="text-amber-300 shrink-0" />
          )}
          <span className="text-sm font-semibold text-stone-100 truncate">{c.title}</span>
        </div>
        <span className="text-[11px] text-stone-500 shrink-0">
          {variant === 'unlocked' ? unlockDate.toLocaleDateString() : sealedFor}
        </span>
      </div>
      <div className="mt-1 text-xs text-stone-500 flex items-center gap-2 flex-wrap">
        <span>{c.isMine ? `to ${c.toName}` : `from ${c.fromName}`}</span>
        {variant !== 'unlocked' && (
          <>
            <span className="text-stone-700">·</span>
            <span>opens {unlockDate.toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
          </>
        )}
        {c.firstReadAt && (
          <>
            <span className="text-stone-700">·</span>
            <span className="text-emerald-400/70">read {new Date(c.firstReadAt).toLocaleDateString()}</span>
          </>
        )}
      </div>
    </button>
  )
}

// ─── View capsule modal ──────────────────────────────────────────────────────

interface ViewModalProps {
  capsuleListItem: CapsuleListItem
  onClose: () => void
  onCancel: () => void | Promise<void>
}

function ViewCapsuleModal({ capsuleListItem, onClose, onCancel }: ViewModalProps) {
  const [data, setData] = useState<CapsuleViewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  useEffect(() => {
    let cancel = false
    async function load() {
      const res = await viewCapsule(capsuleListItem.id)
      if (cancel) return
      if ('error' in res) setError(res.error)
      else setData(res)
    }
    load()
    return () => { cancel = true }
  }, [capsuleListItem.id])

  async function doCancel() {
    setCancelling(true)
    const res = await cancelCapsule(capsuleListItem.id)
    setCancelling(false)
    if (res?.error) { setError(res.error); return }
    await onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100 truncate">
            {data?.isUnlocked ? <Mail size={16} className="text-emerald-400 shrink-0" /> : <Lock size={16} className="text-amber-400 shrink-0" />}
            <span className="truncate">{data?.title ?? capsuleListItem.title}</span>
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!error && !data && <p className="text-sm text-stone-500">Loading…</p>}
          {data && (
            <>
              <div className="text-xs text-stone-500 mb-4 flex flex-wrap gap-x-3 gap-y-1">
                <span>From <span className="text-stone-300">{data.fromName ?? '?'}</span></span>
                <span>To <span className="text-stone-300">{data.toName ?? '?'}</span></span>
                <span>Unlocks <span className="text-stone-300">{new Date(data.unlockAt).toLocaleDateString(undefined, { dateStyle: 'long' })}</span></span>
              </div>

              {data.isUnlocked ? (
                <div className="text-sm text-stone-200 leading-relaxed whitespace-pre-wrap">
                  {data.body || <span className="italic text-stone-500">(empty message)</span>}
                </div>
              ) : (
                <div className="text-center py-12 text-stone-400 italic">
                  <Lock size={32} className="mx-auto text-amber-400/60 mb-3" />
                  <p>Sealed until {new Date(data.unlockAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.</p>
                  <p className="mt-1 text-xs text-stone-500">{formatRelative(new Date(data.unlockAt))} from now.</p>
                </div>
              )}

              {data.isMine && !data.isUnlocked && (
                <div className="mt-6 pt-4 border-t border-stone-800">
                  {!cancelConfirm ? (
                    <button
                      type="button"
                      onClick={() => setCancelConfirm(true)}
                      className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-red-400 transition"
                    >
                      <Trash2 size={12} />
                      Cancel and delete this capsule
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-stone-400">Sure? This deletes the capsule for good.</span>
                      <button type="button" onClick={doCancel} disabled={cancelling} className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50">
                        {cancelling ? 'Deleting…' : 'Delete'}
                      </button>
                      <button type="button" onClick={() => setCancelConfirm(false)} className="px-2 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300">
                        Keep
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(target: Date): string {
  const ms = target.getTime() - Date.now()
  const abs = Math.abs(ms)
  const past = ms < 0
  const days = abs / 86_400_000
  if (days < 1) {
    const hours = abs / 3_600_000
    if (hours < 1) return past ? 'just now' : 'within the hour'
    return past ? `${Math.round(hours)} hr ago` : `in ${Math.round(hours)} hr`
  }
  if (days < 30) return past ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago` : `in ${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  const months = days / 30.44
  if (months < 12) return past ? `${Math.round(months)} mo ago` : `in ${Math.round(months)} mo`
  const years = days / 365.25
  const y = years < 2 ? years.toFixed(1) : Math.round(years).toString()
  return past ? `${y} yr ago` : `in ${y} yr`
}
