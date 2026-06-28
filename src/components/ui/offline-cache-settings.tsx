'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CloudDownload, RefreshCw, Trash2, X, CheckCircle2, ShieldAlert, AlertTriangle } from 'lucide-react'
import { fetchOfflineSnapshot } from '@/lib/actions/offline-snapshot'
import {
  getSnapshotMeta,
  saveSnapshot,
  clearSnapshot,
  type SnapshotMeta,
} from '@/lib/offline-store'

type Mode = 'idle' | 'setup' | 'refresh' | 'remove'

export function OfflineCacheSettings() {
  const [meta, setMeta] = useState<SnapshotMeta | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const m = await getSnapshotMeta()
        if (!cancelled) setMeta(m)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function refreshMeta() {
    setMeta(await getSnapshotMeta())
  }

  if (!loaded) {
    return (
      <div className="text-sm text-stone-500">Checking offline status…</div>
    )
  }

  const exists = meta != null
  const stale = exists && meta!.ageDays > 7

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-400">
        Save an encrypted copy of your vault to this phone so you can read passwords
        when there&rsquo;s no internet or cell signal. The local PIN you set here
        never leaves the device — even the vault owner can&rsquo;t recover it. Refresh weekly so
        new entries get included.
      </p>

      {!exists && (
        <button
          type="button"
          onClick={() => setMode('setup')}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          <CloudDownload size={15} />
          Set up offline access
        </button>
      )}

      {exists && (
        <>
          <div className={`flex items-start gap-3 p-3 rounded-lg border ${stale ? 'bg-amber-950/20 border-amber-700/40' : 'bg-emerald-950/20 border-emerald-700/40'}`}>
            {stale ? (
              <AlertTriangle size={16} className="text-amber-300 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 size={16} className="text-emerald-300 mt-0.5 shrink-0" />
            )}
            <div className="text-sm">
              <p className={stale ? 'text-amber-200 font-medium' : 'text-emerald-200 font-medium'}>
                {stale ? 'Offline cache is getting stale.' : 'Offline cache is ready.'}
              </p>
              <p className="text-stone-400 text-xs mt-0.5">
                Last saved {formatAge(meta!.ageDays)} ({new Date(meta!.snapshotAt).toLocaleString()}).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode('refresh')}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-700 hover:bg-stone-600 text-stone-100 rounded-lg transition"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <Link
              href="/offline"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg transition"
            >
              Open offline page
            </Link>
            <button
              type="button"
              onClick={() => setMode('remove')}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-red-900/30 text-stone-400 hover:text-red-300 border border-stone-700 hover:border-red-800/40 rounded-lg transition ml-auto"
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        </>
      )}

      {(mode === 'setup' || mode === 'refresh') && (
        <PinModal
          mode={mode}
          onClose={() => setMode('idle')}
          onSaved={async () => { await refreshMeta(); setMode('idle') }}
        />
      )}

      {mode === 'remove' && (
        <RemoveModal
          onClose={() => setMode('idle')}
          onRemoved={async () => { await refreshMeta(); setMode('idle') }}
        />
      )}
    </div>
  )
}

function formatAge(days: number): string {
  if (days < 1 / 24) return 'just now'
  if (days < 1) return `${Math.round(days * 24)} hr ago`
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} ago`
  return `${Math.round(days / 30)} month${Math.round(days / 30) === 1 ? '' : 's'} ago`
}

interface PinModalProps {
  mode: 'setup' | 'refresh'
  onClose: () => void
  onSaved: () => void | Promise<void>
}

function PinModal({ mode, onClose, onSaved }: PinModalProps) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'pin' | 'fetching' | 'encrypting' | 'done'>('pin')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pin.length < 6) {
      setError('PIN must be at least 6 characters.')
      return
    }
    if (mode === 'setup' && pin !== confirmPin) {
      setError('PINs don’t match.')
      return
    }

    setBusy(true)
    try {
      setStep('fetching')
      const payload = await fetchOfflineSnapshot()
      setStep('encrypting')
      await saveSnapshot(pin, payload)
      setStep('done')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save offline cache.')
      setStep('pin')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-100">
            <ShieldAlert size={18} className="text-emerald-400" />
            {mode === 'setup' ? 'Set up offline access' : 'Refresh offline cache'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {mode === 'setup' && (
            <div className="text-sm text-stone-400 space-y-2">
              <p>
                Pick a PIN of <strong>6 or more characters</strong>. You&rsquo;ll
                enter it any time you read your offline copy.
              </p>
              <p className="text-xs text-stone-500">
                Forgot it later? No big deal — just refresh with a new one. Your
                only loss is having to re-download the snapshot.
              </p>
            </div>
          )}
          {mode === 'refresh' && (
            <p className="text-sm text-stone-400">
              Enter the PIN to encrypt the new snapshot. Use your old PIN, or pick a new one — both work.
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
              autoComplete="new-password"
              autoFocus
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>

          {mode === 'setup' && (
            <div>
              <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                Confirm PIN
              </label>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {step === 'fetching' && <p className="text-sm text-stone-400">Fetching latest data…</p>}
          {step === 'encrypting' && <p className="text-sm text-stone-400">Encrypting and saving…</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || pin.length < 6 || (mode === 'setup' && pin !== confirmPin)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {busy ? (
                <>
                  <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                mode === 'setup' ? 'Save offline copy' : 'Refresh'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface RemoveModalProps {
  onClose: () => void
  onRemoved: () => void | Promise<void>
}

function RemoveModal({ onClose, onRemoved }: RemoveModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await clearSnapshot()
      await onRemoved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-stone-800">
          <h2 className="text-base font-semibold text-stone-100">Remove offline cache?</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-stone-400">
            The encrypted snapshot on this device will be deleted. You&rsquo;ll need to set up offline access again to read your vault when offline.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 disabled:bg-red-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
