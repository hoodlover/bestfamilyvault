import Link from 'next/link'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import type { PriceCreepAlert } from '@/lib/price-creep'

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

export function PriceCreepCard({ alerts }: { alerts: PriceCreepAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <div className="rounded-2xl border border-amber-700/40 bg-gradient-to-br from-amber-950/40 via-stone-900/60 to-black/80 p-4 md:p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-900/40 border border-amber-700/40">
          <TrendingUp size={16} className="text-amber-300" />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400/80 font-semibold">Price-creep alert</p>
          <p className="text-sm text-stone-300 mt-0.5">
            {alerts.length} recurring bill{alerts.length === 1 ? '' : 's'} jumped 20% or more.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {alerts.slice(0, 5).map((a) => {
          const delta = a.currentAmountCents - a.prevAmountCents
          const pct = Math.round(a.pctChange * 100)
          return (
            <li key={a.entryId}>
              <Link
                href={`/entries/${a.entryId}`}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-stone-900/60 border border-stone-700/40 hover:border-amber-700/40 transition"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-100 truncate">{a.title}</p>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      {formatCents(a.prevAmountCents)} → <span className="text-amber-300 font-medium">{formatCents(a.currentAmountCents)}</span>
                      <span className="text-stone-500"> · {a.prevPeriodEnd.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })} → {a.currentPeriodEnd.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span>
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-amber-300">+{pct}%</p>
                  <p className="text-[10px] text-stone-500">+{formatCents(delta)}</p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
