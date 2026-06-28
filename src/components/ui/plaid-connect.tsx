'use client'

// Plaid integration UI for bank_account / credit_card entries. Three
// states:
//   1. Not linked  → "Connect with Plaid" button that opens the widget
//   2. Linked, never synced → "Sync now" + "Account linked"
//   3. Linked, synced before → "Sync now" + "Last synced X ago"
//
// On widget success the component calls /api/plaid/exchange to swap
// the public_token for an access_token (server-side) and then routes
// the user back to a refreshed view of the entry detail page.

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link'
import { Building2, Link2, RefreshCw, CheckCircle2 } from 'lucide-react'

interface Props {
  entryId: string
  /** When set, the entry is already linked. The component swaps to the
   *  "linked + sync" UI instead of showing the Connect button. */
  linkedItemId?: string | null
  /** Plaid's per-account id we pinned at exchange time. Surfaced as
   *  metadata in the linked-state UI. */
  linkedAccountId?: string | null
  /** Last successful sync timestamp; null when never synced. Drives
   *  the "Last synced X ago" line. */
  syncedAt?: string | null
}

function formatRelative(ts: string): string {
  const date = new Date(ts)
  if (isNaN(date.getTime())) return 'unknown'
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return date.toLocaleDateString()
}

export function PlaidConnect({ entryId, linkedItemId, linkedAccountId, syncedAt }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncResult, setLastSyncResult] = useState<{
    transactionsAdded: number
    balanceUpdated: boolean
  } | null>(null)

  const isLinked = !!linkedItemId

  // Mint a link_token lazily when the user actually clicks Connect.
  // Plaid expects tokens to be short-lived and tied to one session, so
  // pre-fetching at mount would waste a call for users who never link.
  async function fetchLinkToken() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/plaid/link-token', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
      setLinkToken(data.link_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Plaid Link.')
    } finally {
      setBusy(false)
    }
  }

  const onSuccess = useCallback(
    async (public_token: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setBusy(true)
      setError(null)
      try {
        // Pick the first account Plaid returned — most users link a
        // single account at a time, and even when they pick more we
        // want this entry to mirror just one. (Linking more accounts
        // means creating more entries and linking those individually.)
        const accountId = metadata.accounts[0]?.id
        if (!accountId) throw new Error('No account selected.')
        const res = await fetch('/api/plaid/exchange', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ public_token, entryId, accountId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
        // Wipe the in-component link token so re-opening starts a new
        // session if the user wants to re-link.
        setLinkToken(null)
        startTransition(() => router.refresh())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save Plaid link.')
      } finally {
        setBusy(false)
      }
    },
    [entryId, router],
  )

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      // User closed the widget without completing — clear the token so
      // a future click mints a fresh one. Plaid tokens are single-use.
      setLinkToken(null)
    },
  })

  // Auto-open the widget the moment a link token is ready. Without
  // this the user would have to click twice.
  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  async function handleSync() {
    setSyncing(true)
    setError(null)
    setLastSyncResult(null)
    try {
      const res = await fetch(`/api/plaid/sync/${entryId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Sync failed (${res.status})`)
      setLastSyncResult({
        transactionsAdded: data.transactionsAdded ?? 0,
        balanceUpdated: !!data.balanceUpdated,
      })
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  // ─── Not linked state ──────────────────────────────────────────────
  if (!isLinked) {
    return (
      <div className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-900/30 border border-sky-700/40 shrink-0">
            <Building2 size={16} className="text-sky-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-200">Connect with Plaid</p>
            <p className="text-xs text-stone-500 mt-0.5">Get balances</p>
          </div>
          <button
            type="button"
            onClick={fetchLinkToken}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-700/60 bg-sky-950/50 hover:bg-sky-900/40 text-sky-200 text-sm font-medium transition disabled:opacity-50"
          >
            <Link2 size={13} />
            {busy ? 'Opening…' : 'Connect'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    )
  }

  // ─── Linked state ──────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-emerald-700/40 bg-stone-900/40 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-900/30 border border-emerald-700/40 shrink-0">
          <CheckCircle2 size={16} className="text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-200">Linked via Plaid</p>
          <p className="text-xs text-stone-500 mt-0.5">
            {syncedAt
              ? `Last synced ${formatRelative(syncedAt)}.`
              : 'Not yet synced — tap Sync now to pull the historical baseline.'}
          </p>
          {linkedAccountId && (
            <p className="text-[10px] text-stone-600 mt-0.5 font-mono truncate" title={linkedAccountId}>
              {linkedAccountId}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/50 hover:bg-emerald-900/40 text-emerald-200 text-sm font-medium transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {lastSyncResult && (
        <p className="mt-2 text-xs text-emerald-300">
          {lastSyncResult.transactionsAdded > 0
            ? `Added ${lastSyncResult.transactionsAdded} transaction${lastSyncResult.transactionsAdded === 1 ? '' : 's'}.`
            : 'No new transactions.'}
          {lastSyncResult.balanceUpdated && ' Balance refreshed.'}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
