import Link from 'next/link'
import { TrendingUp, TrendingDown, Building2, Plus, Minus } from 'lucide-react'
import type { LlcSnapshot } from '@/lib/llc-snapshot'

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

interface Props {
  snapshot: LlcSnapshot
  /** Where the card links to when tapped — usually the LLC's category drill-down. */
  href?: string
}

export function LlcSnapshotCard({ snapshot, href }: Props) {
  // Bail completely when the LLC subcategory doesn't exist OR no entries
  // are tagged. The user expects this widget below NetWorthCard; an empty
  // placeholder would just add noise.
  if (!snapshot.llcLabel) return null
  if (snapshot.contributingCount === 0 && snapshot.ytdLineCount === 0) return null

  const delta =
    snapshot.prevBalanceCents != null ? snapshot.balanceCents - snapshot.prevBalanceCents : null
  const isUp = delta != null && delta > 0
  const isDown = delta != null && delta < 0

  const asOfLabel = snapshot.asOf
    ? snapshot.asOf.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const netYtdCents = snapshot.ytdInflowCents - snapshot.ytdOutflowCents

  const card = (
    <div className="rounded-2xl border border-sky-700/30 bg-gradient-to-br from-sky-950/40 via-stone-900/60 to-black/80 p-4 md:p-5 mb-6">
      {/* Top half — running balance + 30d delta. Mirrors NetWorthCard
          structure but in sky tones so it's visibly a sibling, not the
          same widget. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-900/40 border border-sky-700/40">
            <Building2 size={16} className="text-sky-300" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-sky-400/80 font-semibold">{snapshot.llcLabel}</p>
            <p className="text-2xl md:text-3xl font-bold text-stone-100 mt-0.5 leading-tight">
              {snapshot.contributingCount > 0
                ? formatCents(snapshot.balanceCents, true)
                : <span className="text-stone-400 text-base font-medium">No tracked balance</span>}
            </p>
          </div>
        </div>
        {delta != null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${isUp ? 'text-emerald-300' : isDown ? 'text-red-300' : 'text-stone-400'}`}>
            {isUp && <TrendingUp size={12} />}
            {isDown && <TrendingDown size={12} />}
            <span>
              {delta >= 0 ? '+' : ''}{formatCents(delta)} <span className="text-stone-500">/ 30d</span>
            </span>
          </div>
        )}
      </div>

      {asOfLabel && (
        <p className="text-[11px] text-stone-500 mb-3">
          As of {asOfLabel} · {snapshot.contributingCount} {snapshot.contributingCount === 1 ? 'account' : 'accounts'} tracked
        </p>
      )}

      {/* YTD income / expense breakdown. Only shown when statement
          line items exist — otherwise the box would lie about activity. */}
      {snapshot.ytdLineCount > 0 && (
        <>
          <div className="border-t border-stone-800/80 pt-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">
              YTD activity · {snapshot.ytdLineCount} line {snapshot.ytdLineCount === 1 ? 'item' : 'items'}
            </p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-stone-500 flex items-center gap-1">
                  <Plus size={11} className="text-emerald-400" />
                  Inflows
                </p>
                <p className="text-emerald-300 font-semibold text-sm mt-0.5">{formatCents(snapshot.ytdInflowCents)}</p>
              </div>
              <div>
                <p className="text-stone-500 flex items-center gap-1">
                  <Minus size={11} className="text-red-400" />
                  Outflows
                </p>
                <p className="text-red-300 font-semibold text-sm mt-0.5">{formatCents(snapshot.ytdOutflowCents)}</p>
              </div>
              <div>
                <p className="text-stone-500">Net</p>
                <p className={`font-semibold text-sm mt-0.5 ${netYtdCents >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {formatCents(netYtdCents, true)}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )

  return href ? <Link href={href} className="block">{card}</Link> : card
}
