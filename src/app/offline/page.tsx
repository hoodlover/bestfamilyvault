'use client'

// Static-shell offline page. Contains zero server-rendered data so it's
// safe for the service worker to cache one copy for everyone. All content
// renders from IndexedDB after the user enters their local PIN.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Lock, Eye, EyeOff, Copy, Search, ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react'
import {
  hasSnapshot,
  getSnapshotMeta,
  loadSnapshot,
  type SnapshotMeta,
} from '@/lib/offline-store'
import type { OfflineSnapshotPayload } from '@/lib/actions/offline-snapshot'

export default function OfflinePage() {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null)
  const [exists, setExists] = useState<boolean | null>(null)
  const [data, setData] = useState<OfflineSnapshotPayload | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const has = await hasSnapshot()
        if (cancelled) return
        setExists(has)
        if (has) setMeta(await getSnapshotMeta())
      } catch {
        if (!cancelled) setExists(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { data } = await loadSnapshot<OfflineSnapshotPayload>(pin)
      setData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock.')
    } finally {
      setBusy(false)
    }
  }

  // Locked state — render the unlock form
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900/80 backdrop-blur shadow-2xl p-6 md:p-8">
          <div className="flex justify-center mb-4">
            <div className="h-14 w-14 rounded-full bg-emerald-900/30 border border-emerald-700/50 flex items-center justify-center">
              <Lock size={26} className="text-emerald-300" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-stone-100 text-center mb-1">Offline Vault</h1>
          <p className="text-sm text-stone-400 text-center mb-6">
            Read your saved passwords without the network.
          </p>

          {exists === false && (
            <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 mb-4">
              <p className="text-sm text-amber-200 font-medium mb-1">No offline cache on this device.</p>
              <p className="text-xs text-stone-400">
                Sign in normally and visit <strong>Settings → Offline access → Set up offline access</strong> to save an encrypted copy here.
              </p>
            </div>
          )}

          {exists && (
            <form onSubmit={unlock} className="space-y-4">
              {meta && (
                <p className="text-xs text-stone-500 text-center">
                  Saved {new Date(meta.snapshotAt).toLocaleString()}
                  {meta.ageDays > 7 && (
                    <span className="block text-amber-400 mt-0.5">
                      Cache is {Math.round(meta.ageDays)} days old — refresh when you&rsquo;re online.
                    </span>
                  )}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                  Local PIN
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                  className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={busy || pin.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
              >
                {busy ? (
                  <>
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Unlocking…
                  </>
                ) : (
                  'Unlock'
                )}
              </button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-stone-800 text-center">
            <Link href="/dashboard" className="text-xs text-stone-500 hover:text-stone-300 transition">
              ← Back to vault (online)
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <UnlockedView data={data} onLock={() => { setData(null); setPin('') }} />
}

interface UnlockedViewProps {
  data: OfflineSnapshotPayload
  onLock: () => void
}

function UnlockedView({ data, onLock }: UnlockedViewProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data
    const e = data.entries.filter((x) => {
      const blob = [
        x.title, x.username, x.password, x.url,
        x.bankName, x.accountType, x.accountNumber,
        x.cardholderName, x.cardNetwork, x.cardNumber,
        x.firstName, x.lastName, x.passport, x.driversLicense,
        x.noteContent,
      ].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
    const n = data.notes.filter((x) =>
      (x.title + ' ' + x.content).toLowerCase().includes(q)
    )
    return { ...data, entries: e, notes: n }
  }, [data, query])

  // Group by category
  const byCategory = useMemo(() => {
    const out: Record<string, { name: string; entries: typeof data.entries; notes: typeof data.notes }> = {}
    for (const cat of data.categories) {
      out[cat.id] = { name: cat.name, entries: [], notes: [] }
    }
    out['__none__'] = { name: 'Uncategorized', entries: [], notes: [] }
    for (const e of filtered.entries) {
      const k = e.categoryId ?? '__none__'
      if (!out[k]) out[k] = { name: 'Uncategorized', entries: [], notes: [] }
      out[k].entries.push(e)
    }
    for (const n of filtered.notes) {
      const k = n.categoryId ?? '__none__'
      if (!out[k]) out[k] = { name: 'Uncategorized', entries: [], notes: [] }
      out[k].notes.push(n)
    }
    return Object.entries(out)
      .filter(([, v]) => v.entries.length > 0 || v.notes.length > 0)
      .sort(([a], [b]) => {
        const ai = data.categories.find((c) => c.id === a)?.sortOrder ?? 9999
        const bi = data.categories.find((c) => c.id === b)?.sortOrder ?? 9999
        return ai - bi
      })
  }, [data, filtered])

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-3xl mx-auto">
      <header className="flex items-start justify-between gap-3 mb-5 pb-4 border-b border-stone-800">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-stone-100 flex items-center gap-2">
            <ShieldAlert size={20} className="text-emerald-400" />
            Offline Vault
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {data.user.name ?? data.user.email} · saved {new Date(data.generatedAt).toLocaleDateString()}
          </p>
        </div>
        <button
          type="button"
          onClick={onLock}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg transition shrink-0"
        >
          <Lock size={12} />
          Lock
        </button>
      </header>

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      {byCategory.length === 0 && (
        <p className="text-sm text-stone-500 text-center py-12">
          {query ? `No matches for "${query}".` : 'Nothing in your offline copy yet.'}
        </p>
      )}

      <div className="space-y-3">
        {byCategory.map(([catId, group]) => (
          <CategoryGroup key={catId} name={group.name} entries={group.entries} notes={group.notes} />
        ))}
      </div>

      <div className="mt-8 pt-4 border-t border-stone-800 text-center">
        <Link href="/dashboard" className="text-xs text-stone-500 hover:text-stone-300 transition">
          ← Back to live vault (when online)
        </Link>
      </div>
    </div>
  )
}

function CategoryGroup({
  name,
  entries,
  notes,
}: {
  name: string
  entries: OfflineSnapshotPayload['entries']
  notes: OfflineSnapshotPayload['notes']
}) {
  const [open, setOpen] = useState(true)
  const total = entries.length + notes.length

  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-800/50 transition"
      >
        <span className="font-semibold text-stone-200">{name}</span>
        <span className="flex items-center gap-2 text-xs text-stone-500">
          {total}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {entries.map((e) => <EntryCard key={e.id} entry={e} />)}
          {notes.map((n) => <NoteCard key={n.id} note={n} />)}
        </div>
      )}
    </section>
  )
}

function EntryCard({ entry }: { entry: OfflineSnapshotPayload['entries'][number] }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-stone-100 truncate">{entry.title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 shrink-0">{entry.type.replace('_', ' ')}</span>
      </div>
      <div className="space-y-1">
        {entry.type === 'login' && (
          <>
            <Field label="URL" value={entry.url} />
            <Field label="Username" value={entry.username} copyable />
            <Field label="Password" value={entry.password} copyable secret />
          </>
        )}
        {entry.type === 'bank_account' && (
          <>
            <Field label="Bank" value={entry.bankName} />
            <Field label="Type" value={entry.accountType} />
            <Field label="Account #" value={entry.accountNumber} copyable secret />
            <Field label="Routing #" value={entry.routingNumber} copyable secret />
          </>
        )}
        {entry.type === 'credit_card' && (
          <>
            <Field label="Cardholder" value={entry.cardholderName} />
            <Field label="Network" value={entry.cardNetwork} />
            <Field label="Card #" value={entry.cardNumber} copyable secret />
            <Field label="Expiry" value={entry.expiryDate} />
            <Field label="CVV" value={entry.cvv} copyable secret />
          </>
        )}
        {entry.type === 'identity' && (
          <>
            <Field label="Name" value={[entry.firstName, entry.lastName].filter(Boolean).join(' ') || null} />
            <Field label="DOB" value={entry.dateOfBirth} />
            <Field label="SSN" value={entry.ssn} copyable secret />
            <Field label="Passport" value={entry.passport} copyable secret />
            <Field label="DL" value={entry.driversLicense} copyable secret />
          </>
        )}
        {entry.phone && <Field label="Phone" value={entry.phone} copyable />}
        {entry.noteContent && (
          <div className="mt-2 pt-2 border-t border-stone-800 text-xs text-stone-400 whitespace-pre-wrap">{entry.noteContent}</div>
        )}
      </div>
    </div>
  )
}

function NoteCard({ note }: { note: OfflineSnapshotPayload['notes'][number] }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-stone-100 truncate">{note.title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-stone-500 shrink-0">note</span>
      </div>
      {note.content && (
        <p className="text-xs text-stone-400 whitespace-pre-wrap">{note.content}</p>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  copyable,
  secret,
}: {
  label: string
  value: string | null | undefined
  copyable?: boolean
  secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!value) return null
  const display = secret && !revealed ? '••••••••' : value

  async function copy() {
    try {
      await navigator.clipboard.writeText(value!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-stone-500 w-20 shrink-0">{label}</span>
      <span className="flex-1 font-mono text-stone-200 truncate">{display}</span>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="p-1 text-stone-500 hover:text-stone-200 hover:bg-stone-800 rounded transition"
          aria-label={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      )}
      {copyable && (
        <button
          type="button"
          onClick={copy}
          className="p-1 text-stone-500 hover:text-emerald-400 hover:bg-stone-800 rounded transition"
          aria-label="Copy"
        >
          {copied ? <span className="text-[10px] text-emerald-400 px-1">copied</span> : <Copy size={12} />}
        </button>
      )}
    </div>
  )
}
