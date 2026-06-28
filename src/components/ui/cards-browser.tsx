'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'

export interface CardRow {
  id: string
  type: 'credit_card' | 'identity'
  title: string
  cardholderName: string | null
  cardNumber: string | null
  cardNetwork: string | null
  expiryDate: string | null
  firstName: string | null
  lastName: string | null
  passport: string | null
  driversLicense: string | null
  ownerName: string | null
  ownerImage: string | null
  thumbUrl: string | null
}

interface Props {
  cards: CardRow[]
}

export function CardsBrowser({ cards }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((c) => {
      const haystack = [
        c.title,
        c.cardholderName,
        c.cardNetwork,
        c.cardNumber,
        c.firstName,
        c.lastName,
        c.passport,
        c.driversLicense,
        c.ownerName,
        c.type === 'credit_card' ? 'credit card' : 'identity id',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [cards, query])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-900/60 border border-stone-700/60 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20 transition">
        <Search size={16} className="text-stone-500 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, name, network, last-4, DL #, passport #..."
          className="flex-1 min-w-0 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-none"
        />
        {query && (
          <span className="text-[11px] text-stone-500 shrink-0">{filtered.length} of {cards.length}</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-8 text-center text-sm text-stone-400">
          {cards.length === 0 ? 'No cards in the vault yet.' : 'No cards match that search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <CardTile key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function CardTile({ card }: { card: CardRow }) {
  const expiry = parseExpiry(card.expiryDate, card.type)
  const expiryClass =
    expiry?.status === 'expired'
      ? 'bg-red-900/60 text-red-200 border-red-700/60'
      : expiry?.status === 'soon'
        ? 'bg-amber-900/60 text-amber-200 border-amber-700/60'
        : 'bg-stone-800/60 text-stone-300 border-stone-700/60'

  const subtitle = subtitleFor(card)
  const fallbackIcon =
    card.type === 'credit_card'
      ? '/icons/cobb/icons/system/creditcard.png'
      : '/icons/cobb/icons/family/dl.png'

  return (
    <Link
      href={`/entries/${card.id}`}
      className="block rounded-xl border border-stone-800 bg-stone-900/40 hover:bg-stone-900/70 hover:border-stone-700 transition overflow-hidden"
    >
      <div className="relative aspect-[16/10] bg-stone-800 flex items-center justify-center overflow-hidden">
        {card.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fallbackIcon}
            alt=""
            width={72}
            height={72}
            className="object-contain opacity-80"
          />
        )}
        {expiry && (
          <span
            className={clsx(
              'absolute top-2 right-2 px-2 py-0.5 rounded-md border text-[10px] font-medium uppercase tracking-wide',
              expiryClass,
            )}
          >
            {expiry.label}
          </span>
        )}
      </div>
      <div className="p-3 space-y-0.5">
        <div className="text-sm font-medium text-stone-100 truncate">{card.title}</div>
        {subtitle && <div className="text-[11px] text-stone-400 truncate">{subtitle}</div>}
        {card.ownerName && (
          <div className="text-[10px] text-stone-500 truncate">Owned by {card.ownerName}</div>
        )}
      </div>
    </Link>
  )
}

function subtitleFor(card: CardRow): string | null {
  if (card.type === 'credit_card') {
    const network = card.cardNetwork ?? ''
    const last4 = last4Of(card.cardNumber)
    if (network && last4) return `${network} · •••• ${last4}`
    if (network) return network
    if (last4) return `•••• ${last4}`
    return card.cardholderName ?? null
  }
  const fullName = [card.firstName, card.lastName].filter(Boolean).join(' ').trim()
  const idBits: string[] = []
  if (card.driversLicense) idBits.push(`DL ••• ${last4Of(card.driversLicense) ?? ''}`.trim())
  if (card.passport) idBits.push(`PP ••• ${last4Of(card.passport) ?? ''}`.trim())
  const ids = idBits.join(' · ')
  if (fullName && ids) return `${fullName} · ${ids}`
  return fullName || ids || null
}

function last4Of(s: string | null): string | null {
  if (!s) return null
  const digits = s.replace(/\D/g, '')
  if (digits.length >= 4) return digits.slice(-4)
  if (s.length >= 4) return s.slice(-4)
  return null
}

interface ExpiryInfo {
  label: string
  status: 'expired' | 'soon' | 'ok'
}

function parseExpiry(raw: string | null, type: 'credit_card' | 'identity'): ExpiryInfo | null {
  if (!raw) return null
  const s = raw.trim()
  let year: number | null = null
  let month: number | null = null
  let day: number | null = null

  // MM/YY (credit cards) — month/year only, no day. Pin to last day of month.
  const mmYY = /^(\d{1,2})\/(\d{2})$/.exec(s)
  if (mmYY) {
    month = Number(mmYY[1])
    year = 2000 + Number(mmYY[2])
    day = lastDayOfMonth(year, month)
  }
  // MM/YYYY
  if (!month) {
    const mmYYYY = /^(\d{1,2})\/(\d{4})$/.exec(s)
    if (mmYYYY) {
      month = Number(mmYYYY[1])
      year = Number(mmYYYY[2])
      day = lastDayOfMonth(year, month)
    }
  }
  // MM/DD/YYYY (identity docs)
  if (!month) {
    const mmDDYYYY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
    if (mmDDYYYY) {
      month = Number(mmDDYYYY[1])
      day = Number(mmDDYYYY[2])
      year = Number(mmDDYYYY[3])
    }
  }
  if (!month || !year || !day) return null

  const expiryMs = Date.UTC(year, month - 1, day)
  // No Date.now() in workflow contexts but normal client runs fine.
  const nowMs = Date.parse(new Date().toISOString())
  const diffDays = Math.floor((expiryMs - nowMs) / 86_400_000)

  const label = type === 'credit_card' ? `Exp ${pad2(month)}/${String(year).slice(-2)}` : `Exp ${pad2(month)}/${pad2(day)}/${year}`

  if (diffDays < 0) return { label: 'Expired', status: 'expired' }
  if (diffDays <= 60) return { label, status: 'soon' }
  return { label, status: 'ok' }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
