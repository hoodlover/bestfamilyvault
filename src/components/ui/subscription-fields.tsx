'use client'

// Conditional subscription detail block. Rendered inside both new-entry
// and edit-entry forms when the user has flagged the entry as recurring.
// The amount input shows dollars in the UI but the form name is
// `subscriptionAmountCents`; we convert to cents on blur so the server
// gets a stable integer regardless of how the user typed it.
//
// Paid-with (vault credit-card selector + free-text URL) is rendered
// here too so the "what pays for this / what site bills it" inputs sit
// next to Amount / Period / Renewal. Parent forms own the state and pass
// it in — that way the standalone Paid-with block (for Subscriptions
// entries that aren't marked recurring) can share the same state.

import { useState } from 'react'

interface CreditCardOption {
  id: string
  label: string
  network: string | null
}

interface Props {
  defaultAmountCents?: number | null
  defaultPeriod?: string | null
  defaultStartedAt?: string | null
  defaultRenewsAt?: string | null
  // Paid-with companion inputs — optional so legacy callers that don't
  // pass them just get the amount/period/dates grid like before. When
  // provided, the parent owns state so the same paidWith/paidWithUrl
  // values survive toggling Recurring off + back on.
  paidWith?: string
  setPaidWith?: (v: string) => void
  paidWithUrl?: string
  setPaidWithUrl?: (v: string) => void
  creditCards?: CreditCardOption[]
}

const PERIODS: { value: string; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'one_time', label: 'One-time' },
]

function centsToInputValue(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

function inputValueToCents(raw: string): string {
  const trimmed = raw.replace(/[^0-9.]/g, '').trim()
  if (!trimmed) return ''
  const num = Number(trimmed)
  if (!Number.isFinite(num)) return ''
  return String(Math.round(num * 100))
}

export function SubscriptionFields({
  defaultAmountCents,
  defaultPeriod,
  defaultStartedAt,
  defaultRenewsAt,
  paidWith,
  setPaidWith,
  paidWithUrl,
  setPaidWithUrl,
  creditCards,
}: Props) {
  const showPaidWith = !!setPaidWith && !!setPaidWithUrl && !!creditCards
  // Controlled-only for the dollar field so we can normalise to cents
  // before the form submits. The hidden mirror feeds the server action.
  const [dollarValue, setDollarValue] = useState(centsToInputValue(defaultAmountCents))
  const [centsValue, setCentsValue] = useState(
    defaultAmountCents != null ? String(defaultAmountCents) : '',
  )

  function syncFromDollars(next: string) {
    setDollarValue(next)
    setCentsValue(inputValueToCents(next))
  }

  return (
    <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-3 md:p-4 space-y-3">
      <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80 font-semibold">
        Recurring detail
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-300 mb-1">Amount</label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={dollarValue}
              onChange={(e) => syncFromDollars(e.target.value)}
              placeholder="14.99"
              className="w-full pl-7 pr-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
            {/* Hidden mirror — server reads cents, so the user can type
                12.49 and the action gets 1249. */}
            <input type="hidden" name="subscriptionAmountCents" value={centsValue} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-300 mb-1">Billing period</label>
          <select
            name="subscriptionPeriod"
            defaultValue={defaultPeriod ?? ''}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">— pick one —</option>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-300 mb-1">Started</label>
          <input
            type="date"
            name="subscriptionStartedAt"
            defaultValue={defaultStartedAt ?? ''}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-300 mb-1">Next renewal</label>
          <input
            type="date"
            name="subscriptionRenewsAt"
            defaultValue={defaultRenewsAt ?? ''}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      </div>

      {showPaidWith && (
        <div className="pt-2 border-t border-emerald-800/30 space-y-2">
          <label className="block text-xs font-medium text-stone-300">Paid with</label>
          <select
            name="paidWith"
            value={paidWith ?? ''}
            onChange={(e) => setPaidWith!(e.target.value)}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">— pick one —</option>
            {creditCards!.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}{c.network ? ` (${c.network})` : ''}
              </option>
            ))}
            {/* Preserve a value that's not in the visible list (e.g. card
                was deleted, or user can't see it because it's private) so
                save doesn't blow it away accidentally. */}
            {paidWith && paidWith !== 'other' && !creditCards!.find((c) => c.id === paidWith) && (
              <option value={paidWith}>(card no longer visible)</option>
            )}
            <option value="other">Other (cash / debit / not on file)</option>
          </select>
          {creditCards!.length === 0 && (
            <p className="text-[11px] text-stone-500">
              No credit cards in the vault yet — add one under Finance and it&rsquo;ll show up here.
            </p>
          )}
          <input
            type="url"
            name="paidWithUrl"
            value={paidWithUrl ?? ''}
            onChange={(e) => setPaidWithUrl!(e.target.value)}
            placeholder="Or paste a URL — e.g. https://paypal.com"
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      )}

      <p className="text-[11px] text-stone-500">
        Leave any field blank if you don&rsquo;t know it yet — the entry still tracks as a recurring bill.
      </p>
    </div>
  )
}
