'use client'

// Per-row decision popout for /reconcile. Click the icon to open;
// pick a decision and the line flips classification on save. "Find
// receipt" jumps to /receipts/new with prefilled amount/date and a
// breadcrumb back to /reconcile. "Link existing" runs a server-side
// search for receipts within ±$2 / ±14 days of this line.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  FileText,
  Search,
  Check,
  ArrowLeftRight,
  Banknote,
  UserCircle,
  X,
  Loader2,
  AlertTriangle,
  Plus,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  setStatementLineDecision,
  clearStatementLineDecision,
  findReceiptCandidatesForLine,
} from '@/lib/actions/reconcile'
import type { DecisionKind } from '@/lib/reconcile-classify'

interface Props {
  lineId: string
  amountCents: number
  postedDate: string
  rawDescription: string
  currentDecision: DecisionKind | null
}

interface ReceiptCandidate {
  id: string
  title: string
  merchant: string | null
  totalCents: number
  purchaseDate: string | null
  llcSubcategoryId: string | null
}

const DECISIONS: Array<{
  key: Exclude<DecisionKind, 'matched'>
  label: string
  hint: string
  icon: React.ReactNode
}> = [
  {
    key: 'no_receipt_needed',
    label: 'No receipt needed',
    hint: 'Business expense, recurring sub already tracked, or under-$75 IRS limit',
    icon: <Check size={13} className="text-emerald-400" />,
  },
  {
    key: 'personal',
    label: 'Personal',
    hint: 'Not a business expense, leave it out of the LLC books',
    icon: <UserCircle size={13} className="text-stone-400" />,
  },
  {
    key: 'transfer',
    label: 'Transfer',
    hint: 'Money moving between accounts (Bluevine → BofA, savings sweep)',
    icon: <ArrowLeftRight size={13} className="text-stone-400" />,
  },
  {
    key: 'atm_cash',
    label: 'ATM cash',
    hint: 'ATM withdrawal — cash spent shows up in its own paper trail',
    icon: <Banknote size={13} className="text-stone-400" />,
  },
]

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}$${whole.toLocaleString()}.${frac}`
}

export function LineDecisionActions({
  lineId,
  amountCents,
  postedDate,
  rawDescription,
  currentDecision,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [candidates, setCandidates] = useState<ReceiptCandidate[] | null>(null)
  const [candidatesPending, startCandidatesTransition] = useTransition()
  const [note, setNote] = useState('')

  function commit(decision: DecisionKind, receiptEntryId?: string) {
    setError(null)
    startTransition(async () => {
      const res = await setStatementLineDecision(lineId, {
        decision,
        receiptEntryId: receiptEntryId ?? null,
        note: note.trim() || null,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      setShowLink(false)
      setNote('')
      router.refresh()
    })
  }

  function clear() {
    setError(null)
    startTransition(async () => {
      const res = await clearStatementLineDecision(lineId)
      if (res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  function loadCandidates() {
    setShowLink(true)
    setError(null)
    if (candidates !== null) return
    startCandidatesTransition(async () => {
      const res = await findReceiptCandidatesForLine(lineId)
      if (res.error) {
        setError(res.error)
        return
      }
      setCandidates(res.candidates ?? [])
    })
  }

  // /receipts/new prefill — amount in dollars, date as YYYY-MM-DD,
  // attachDecisionTo carries the line id back so save can flip the
  // decision automatically.
  const prefillAmount = Math.abs(amountCents) / 100
  const findReceiptHref =
    `/receipts/new?prefillAmount=${prefillAmount.toFixed(2)}` +
    `&prefillDate=${postedDate}` +
    `&prefillMerchant=${encodeURIComponent(rawDescription.slice(0, 60))}` +
    `&attachDecisionTo=${encodeURIComponent(lineId)}`

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition',
          currentDecision
            ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
            : 'border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700',
        )}
        aria-label="Decide what this line is"
        aria-expanded={open}
      >
        {currentDecision ? <Check size={12} /> : <ChevronDown size={12} />}
        Decide
      </button>

      {open && (
        <>
          {/* Click-outside backdrop. Click anywhere outside the panel to close. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => { setOpen(false); setShowLink(false) }}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-xl border border-stone-700 bg-stone-900 shadow-xl p-2">
            <div className="px-2 pt-1 pb-2 border-b border-stone-800">
              <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
                {formatCents(amountCents)} · {postedDate}
              </p>
              <p className="text-xs text-stone-400 truncate mt-0.5">{rawDescription}</p>
            </div>

            {showLink ? (
              <LinkExistingReceiptPanel
                candidates={candidates}
                pending={candidatesPending}
                amountCents={amountCents}
                onBack={() => setShowLink(false)}
                onPick={(id) => commit('matched', id)}
              />
            ) : (
              <div className="py-1.5 space-y-0.5">
                {/* Find / link receipt */}
                <a
                  href={findReceiptHref}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-stone-800 text-left transition"
                >
                  <Plus size={13} className="mt-0.5 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-100">Find / upload receipt</p>
                    <p className="text-[10px] text-stone-500 leading-snug">
                      Open the receipt form with amount + date prefilled. Save returns here matched.
                    </p>
                  </div>
                </a>
                <button
                  type="button"
                  onClick={loadCandidates}
                  className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-stone-800 text-left transition"
                >
                  <Search size={13} className="mt-0.5 text-emerald-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-100">Link existing receipt</p>
                    <p className="text-[10px] text-stone-500 leading-snug">
                      Search receipts within ±$2 and ±14 days
                    </p>
                  </div>
                </button>

                <div className="h-px bg-stone-800 my-1.5" />

                {/* Non-receipt decisions */}
                {DECISIONS.map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => commit(d.key)}
                    disabled={pending}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-stone-800 text-left transition disabled:opacity-60"
                  >
                    <span className="mt-0.5 shrink-0">{d.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-stone-100">{d.label}</p>
                      <p className="text-[10px] text-stone-500 leading-snug">{d.hint}</p>
                    </div>
                    {currentDecision === d.key && <Check size={11} className="ml-auto text-emerald-400 mt-0.5" />}
                  </button>
                ))}

                {/* Note + clear */}
                <div className="px-2 pt-2">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="w-full px-2 py-1.5 text-xs bg-stone-800 border border-stone-700 rounded-md text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  />
                </div>
                {currentDecision && (
                  <button
                    type="button"
                    onClick={clear}
                    disabled={pending}
                    className="mt-1 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition disabled:opacity-60"
                  >
                    <X size={11} />
                    Clear decision
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="mt-2 px-2 py-1.5 rounded-md bg-red-950/40 border border-red-800/50 text-[10px] text-red-200 flex items-start gap-1">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {pending && (
              <div className="mt-1 px-2 py-1 text-[10px] text-stone-500 inline-flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" /> Saving…
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LinkExistingReceiptPanel({
  candidates,
  pending,
  amountCents,
  onBack,
  onPick,
}: {
  candidates: ReceiptCandidate[] | null
  pending: boolean
  amountCents: number
  onBack: () => void
  onPick: (id: string) => void
}) {
  const target = Math.abs(amountCents)
  return (
    <div className="py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-stone-400 hover:text-stone-200 transition"
      >
        ← back
      </button>
      <div className="mt-1 max-h-64 overflow-auto">
        {pending && (
          <div className="px-2 py-3 text-[11px] text-stone-500 inline-flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Searching…
          </div>
        )}
        {!pending && candidates && candidates.length === 0 && (
          <div className="px-2 py-3 text-[11px] text-stone-500">
            No receipts found within ±$2 / ±14 days of this line.
          </div>
        )}
        {!pending && candidates && candidates.length > 0 && (
          <div className="space-y-0.5">
            {candidates.map((c) => {
              const closeAmount = Math.abs(c.totalCents - target) <= 200
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c.id)}
                  className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-stone-800 text-left transition"
                >
                  <FileText size={12} className="mt-0.5 text-emerald-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-100 truncate">{c.title}</p>
                    <p className="text-[10px] text-stone-500 truncate">
                      {c.merchant ?? '(no merchant)'} · {c.purchaseDate ?? '—'} · {formatCents(c.totalCents)}
                      {!closeAmount && <span className="ml-1 text-amber-400">{`(off by ${formatCents(c.totalCents - target).replace('-', '')})`}</span>}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
