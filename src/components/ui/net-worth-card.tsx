'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, Plus, Minus, ChevronDown, ChevronUp } from 'lucide-react'
import type { NetWorthSnapshot } from '@/lib/net-worth-shared'

function formatCents(cents: number, signed = false): string {
  const dollars = cents / 100
  const abs = Math.abs(dollars)
  const formatted = abs.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  if (!signed) return formatted
  return cents < 0 ? `−${formatted}` : formatted
}

const COLLAPSED_LIMIT = 6
const LS_EXCLUDED_ENTRIES = 'cobbvault:netWorth:excludedEntryIds'

// Custom hook: persist a string-set to localStorage so the user's
// include/exclude toggles survive a reload. We hydrate after mount
// (avoids SSR mismatch) and write back on every change.
function usePersistedSet(key: string): [Set<string>, (next: Set<string>) => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) setSet(new Set(JSON.parse(raw) as string[]))
    } catch {
      // localStorage unavailable (private mode, etc.) — silent fallback.
    }
  }, [key])
  const update = (next: Set<string>) => {
    setSet(next)
    try {
      window.localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      // ignore quota / availability errors
    }
  }
  return [set, update]
}

export function NetWorthCard({ snapshot }: { snapshot: NetWorthSnapshot }) {
  const [expanded, setExpanded] = useState(false)
  const [excludedEntries, setExcludedEntries] = usePersistedSet(LS_EXCLUDED_ENTRIES)

  // Per-entry filtering only — group-level pills were removed in v250.
  // Each row carries its own checkbox; total recomputes against the set
  // of still-included entries.
  const filtered = useMemo(() => {
    let totalCents = 0
    let assetsCents = 0
    let debtsCents = 0
    for (const item of snapshot.items) {
      if (excludedEntries.has(item.entryId)) continue
      totalCents += item.balanceCents
      if (item.balanceCents >= 0) assetsCents += item.balanceCents
      else debtsCents += -item.balanceCents
    }
    return { totalCents, assetsCents, debtsCents }
  }, [snapshot.items, excludedEntries])

  const isFiltered = excludedEntries.size > 0

  function toggleEntry(entryId: string) {
    const next = new Set(excludedEntries)
    if (next.has(entryId)) next.delete(entryId)
    else next.add(entryId)
    setExcludedEntries(next)
  }

  function clearFilters() {
    setExcludedEntries(new Set())
  }

  if (snapshot.contributingCount === 0) {
    return (
      <div className="rounded-2xl border border-stone-600/50 bg-stone-900/40 p-4 md:p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-2xl p-[2px] bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 shadow-[0_4px_14px_rgba(16,185,129,0.5)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/Finances/cash_money.png"
              alt=""
              className="h-12 w-12 object-contain rounded-[14px] block"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Net worth</p>
            <p className="text-sm text-stone-300 mt-1.5 leading-relaxed">
              Drop a bank or credit-card statement into your <strong>Vault File Drop</strong> folder
              (<code className="text-xs bg-stone-800 border border-stone-700 px-1.5 py-0.5 rounded">C:\Users\lance\Documents\Vault File Drop</code>)
              and run <code className="text-xs bg-stone-800 border border-stone-700 px-1.5 py-0.5 rounded">npm run import:inbox</code>.
              Or tap <strong>+ Add → Asset</strong> to track a house, car, or anything else by hand.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const delta =
    snapshot.prevTotalCents != null ? snapshot.totalCents - snapshot.prevTotalCents : null
  const isUp = delta != null && delta > 0
  const isDown = delta != null && delta < 0

  const asOfLabel = snapshot.asOf
    ? snapshot.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const hasMore = snapshot.items.length > COLLAPSED_LIMIT
  const visibleItems = expanded ? snapshot.items : snapshot.items.slice(0, COLLAPSED_LIMIT)

  return (
    <div className="rounded-2xl border border-stone-600/50 bg-gradient-to-br from-emerald-950/40 via-stone-900/60 to-black/80 p-4 md:p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 rounded-2xl p-[2.5px] bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 shadow-[0_6px_18px_rgba(16,185,129,0.55)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/Finances/cash_money.png"
              alt=""
              className="h-14 w-14 md:h-16 md:w-16 object-contain rounded-[14px] block"
            />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold flex items-center gap-1.5">
              Net worth
              {isFiltered && (
                <span className="text-amber-400/90 normal-case tracking-normal font-medium text-[10px]">
                  · filtered
                </span>
              )}
            </p>
            <p
              className="text-2xl md:text-3xl font-bold text-stone-100 mt-0.5 leading-tight"
              style={{ textShadow: '0 0 18px rgba(16,185,129,0.55), 0 0 4px rgba(16,185,129,0.4)' }}
            >
              {formatCents(filtered.totalCents, true)}
            </p>
          </div>
        </div>
        {delta != null && !isFiltered && (
          <div className={`flex items-center gap-1 text-xs font-medium shrink-0 ${isUp ? 'text-emerald-300' : isDown ? 'text-red-300' : 'text-stone-400'}`}>
            {isUp && <TrendingUp size={12} />}
            {isDown && <TrendingDown size={12} />}
            <span>
              {delta >= 0 ? '+' : ''}{formatCents(delta)} <span className="text-stone-500">/ 30d</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-stone-400 mb-3 flex-wrap">
        <span className="flex items-center gap-1">
          <Plus size={11} className="text-emerald-400" />
          Assets {formatCents(filtered.assetsCents)}
        </span>
        {filtered.debtsCents > 0 && (
          <span className="flex items-center gap-1">
            <Minus size={11} className="text-red-400" />
            Debts {formatCents(filtered.debtsCents)}
          </span>
        )}
        {asOfLabel && <span className="text-stone-500">as of {asOfLabel}</span>}
      </div>

      {visibleItems.length > 0 && (
        <div className="border-t border-stone-800 pt-3 space-y-1.5">
          {visibleItems.map((item) => {
            const entryExcluded = excludedEntries.has(item.entryId)
            return (
              <div
                key={item.entryId}
                className={`flex items-center justify-between gap-3 text-xs rounded px-1.5 py-1 -mx-1.5 transition ${
                  entryExcluded ? 'opacity-50' : 'hover:bg-stone-800/40'
                }`}
              >
                {/* Per-row include/exclude checkbox. Greyed-out palette so
                    the toggle reads as quiet chrome instead of an emerald
                    call-to-action — but still visible. */}
                <button
                  type="button"
                  onClick={() => toggleEntry(item.entryId)}
                  aria-pressed={!entryExcluded}
                  title={entryExcluded ? 'Include in total' : 'Exclude from total'}
                  className={`shrink-0 h-4 w-4 rounded border flex items-center justify-center text-[10px] transition ${
                    entryExcluded
                      ? 'border-stone-700 bg-stone-900/60 text-stone-700'
                      : 'border-stone-500/70 bg-stone-700/40 text-stone-300'
                  }`}
                >
                  {!entryExcluded && '✓'}
                </button>
                <Link
                  href={`/entries/${item.entryId}`}
                  className="flex-1 min-w-0"
                >
                  <span className={`truncate block ${entryExcluded ? 'text-stone-500 line-through' : 'text-stone-300'}`}>
                    {item.title}
                  </span>
                </Link>
                <span className={`tabular-nums font-medium shrink-0 ${
                  entryExcluded
                    ? 'text-stone-600 line-through'
                    : item.balanceCents < 0 ? 'text-red-300' : 'text-stone-100'
                }`}>
                  {formatCents(item.balanceCents, true)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: Reset link only when something is excluded; View-all on
          the right when the snapshot has more rows than the cap. */}
      {(isFiltered || hasMore) && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {isFiltered ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] text-stone-400 hover:text-stone-200 transition"
            >
              Reset filters
            </button>
          ) : (
            <span />
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 hover:text-emerald-200 transition shrink-0"
            >
              {expanded ? (
                <>
                  Show top {COLLAPSED_LIMIT} <ChevronUp size={11} />
                </>
              ) : (
                <>
                  View all {snapshot.items.length} <ChevronDown size={11} />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
