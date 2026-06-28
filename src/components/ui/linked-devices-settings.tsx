'use client'

// Settings panel for the autofill / browser-extension feature. Shows
// every paired client (browser extension, future Android / iOS apps)
// for the signed-in user, and provides "Pair new device" + per-row
// "Revoke" actions.
//
// Pairing flow shown to the user:
//   1. Tap "Pair new device" → modal pops up with a 6-digit code.
//   2. User opens the extension (or app) on the other device.
//   3. User pastes the code into the extension's pairing screen.
//   4. The extension hits /api/clients/pair/complete and gets back a
//      bearer token, which it stores. The settings panel reflects the
//      new device on next refresh.

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Copy, Edit2, HelpCircle, Laptop, Plus, Smartphone, Sparkles, Tablet, Trash2, X } from 'lucide-react'
import {
  listMyClientSessions,
  pruneStaleClientSessions,
  renameClientSession,
  revokeClientSession,
  startPairCode,
  type ClientSessionRow,
} from '@/lib/actions/client-sessions'

interface Props {
  initial: ClientSessionRow[]
}

export function LinkedDevicesSettings({ initial }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<ClientSessionRow[]>(initial)
  const [pairing, setPairing] = useState<{ code: string; expiresAt: Date } | null>(null)
  const [pairError, setPairError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const next = await listMyClientSessions()
    setRows(next)
  }

  async function startPair() {
    setBusy(true)
    setPairError(null)
    const res = await startPairCode()
    setBusy(false)
    if ('error' in res) {
      setPairError(res.error)
      return
    }
    setPairing({ code: res.code, expiresAt: new Date(res.expiresAt) })
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? It'll have to be paired again to keep autofilling.`)) return
    setBusy(true)
    await revokeClientSession(id)
    setBusy(false)
    startTransition(async () => {
      await refresh()
      router.refresh()
    })
  }

  async function rename(id: string, newName: string) {
    const res = await renameClientSession(id, newName)
    if ('error' in res) {
      alert(res.error)
      return
    }
    startTransition(async () => {
      await refresh()
      router.refresh()
    })
  }

  async function pruneStale() {
    if (!confirm('Revoke every device not seen in the last 30 days?')) return
    setBusy(true)
    const res = await pruneStaleClientSessions(30)
    setBusy(false)
    startTransition(async () => {
      await refresh()
      router.refresh()
    })
    alert(res.revoked === 0
      ? 'Nothing to prune — every device has been seen in the last 30 days.'
      : `Revoked ${res.revoked} stale device${res.revoked === 1 ? '' : 's'}.`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-stone-300 flex-1 min-w-0">
          Pair a browser or phone with the vault to autofill your saved logins on
          any website. Each paired device gets its own access — revoke any
          time, instantly.
        </p>
        <button
          type="button"
          onClick={startPair}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition shadow-md shrink-0"
        >
          <Plus size={14} />
          Pair new device
        </button>
      </div>
      <Link
        href="/extension"
        className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition"
      >
        <HelpCircle size={12} />
        Install &amp; setup guide
      </Link>

      {pairError && <p className="text-xs text-red-400">{pairError}</p>}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500 italic">
          No devices paired yet.
        </p>
      ) : (
        <>
          <ul className="rounded-lg border border-stone-700/60 divide-y divide-stone-800 overflow-hidden">
            {rows.map((row) => (
              <DeviceRow
                key={row.id}
                row={row}
                onRevoke={() => revoke(row.id, row.name)}
                onRename={(name) => rename(row.id, name)}
              />
            ))}
          </ul>
          {rows.length > 2 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={pruneStale}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-amber-300 disabled:opacity-50 transition"
                title="Revoke every device not seen in the last 30 days"
              >
                <Sparkles size={11} />
                Prune devices unused for 30+ days
              </button>
            </div>
          )}
        </>
      )}

      {pairing && (
        <PairCodeModal
          code={pairing.code}
          expiresAt={pairing.expiresAt}
          onClose={async () => {
            setPairing(null)
            startTransition(async () => {
              await refresh()
              router.refresh()
            })
          }}
        />
      )}
    </div>
  )
}

function DeviceRow({
  row,
  onRevoke,
  onRename,
}: {
  row: ClientSessionRow
  onRevoke: () => void
  onRename: (name: string) => Promise<void>
}) {
  const Icon = row.platform === 'extension' ? Laptop : row.platform === 'android' ? Smartphone : Tablet
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.name)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (draft.trim() === row.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    await onRename(draft.trim())
    setBusy(false)
    setEditing(false)
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5 bg-stone-900/40">
      <div className="flex items-center justify-center h-9 w-9 rounded-md bg-stone-800 text-stone-300 shrink-0">
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') { setDraft(row.name); setEditing(false) }
            }}
            disabled={busy}
            autoFocus
            className="w-full px-2 py-1 text-sm bg-stone-800 border border-stone-600 rounded text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            placeholder="Chrome - Kitchen laptop"
          />
        ) : (
          <div className="text-sm font-medium text-stone-100 truncate">{row.name}</div>
        )}
        <div className="text-[11px] text-stone-500">
          {row.platform} · paired {formatRelative(row.createdAt)}
          {row.lastSeenAt && <> · last used {formatRelative(row.lastSeenAt)}</>}
        </div>
      </div>
      {editing ? (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          aria-label="Save name"
          title="Save"
          className="p-2 text-emerald-400 hover:text-emerald-300 transition shrink-0"
        >
          <Check size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Rename"
          title="Rename"
          className="p-2 text-stone-500 hover:text-emerald-400 transition shrink-0"
        >
          <Edit2 size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onRevoke}
        aria-label="Revoke"
        title="Revoke"
        className="p-2 text-stone-500 hover:text-red-400 transition shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </li>
  )
}

function PairCodeModal({
  code,
  expiresAt,
  onClose,
}: {
  code: string
  expiresAt: Date
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))

  useEffect(() => {
    const t = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(t)
  }, [expiresAt])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* no-op */ }
  }

  // Close-on-escape.
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-stone-100">Pair a new device</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-stone-300 leading-relaxed">
          Open the Family Vault extension or app on the device you want to pair.
          Enter this code:
        </p>
        <div className="flex items-center justify-center gap-2 py-3 px-4 bg-stone-800 border border-stone-700 rounded-lg">
          <span className="text-3xl font-mono font-bold tracking-[0.4em] text-emerald-300">{code}</span>
          <button
            type="button"
            onClick={copyCode}
            aria-label="Copy code"
            className="ml-3 inline-flex items-center justify-center h-9 w-9 rounded-md bg-stone-700 hover:bg-stone-600 text-stone-200 transition"
          >
            <Copy size={14} />
          </button>
        </div>
        {copied && <p className="text-center text-xs text-emerald-300">Copied!</p>}
        <p className="text-xs text-stone-500 text-center">
          Code expires in {formatCountdown(secondsLeft)}.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 rounded-lg transition"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function formatRelative(d: Date): string {
  const ms = Date.now() - d.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

function formatCountdown(s: number): string {
  if (s <= 0) return 'expired'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}
