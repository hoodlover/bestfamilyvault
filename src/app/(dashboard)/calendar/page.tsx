// Bill / renewal calendar — surfaces every dated entry on a single page so
// nothing sneaks past you. Sorted by upcoming date; flags items in the next
// 30 days; flags expired items at the bottom.
//
// What gets pulled:
//   - Subscriptions: entries where isRecurring=true → subscriptionRenewsAt
//   - Credit cards / bank accounts with an expiryDate
//   - Sub-entries' renewal dates (we only pull master entries; merged
//     children skipped via parentEntryId is null)

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { HelpPopout } from '@/components/ui/help-popout'
import { entries, categories } from '@/lib/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'
import { Calendar, AlertTriangle, Clock, CreditCard, Repeat } from 'lucide-react'
import { decryptEntries } from '@/lib/crypto'
import { getCategoryLabel } from '@/lib/category-presentation'
import { MarkHandledButton } from '@/components/ui/mark-handled-button'

interface CalendarRow {
  entryId: string
  title: string
  type: string
  category: string
  date: Date
  kind: 'renewal' | 'expiry'
  daysUntil: number
  amountCents?: number | null
  period?: string | null
}

function parseExpiry(s: string): Date | null {
  // expiryDate is loose ('MM/YY', 'MM/YYYY', 'YYYY-MM', etc.). Be lenient.
  const trimmed = s.trim()
  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  // MM/YY or MM/YYYY → end of that month
  m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed)
  if (m) {
    const month = parseInt(m[1]) - 1
    let year = parseInt(m[2])
    if (year < 100) year += 2000
    return new Date(year, month + 1, 0) // last day of month
  }
  // YYYY-MM
  m = /^(\d{4})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]), 0)
  return null
}

function parseRenewsAt(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim())
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  return null
}

function formatAmount(cents: number | null | undefined, period: string | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return ''
  const dollars = (cents / 100).toFixed(2)
  return period ? `$${dollars}/${period}` : `$${dollars}`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function relativeWord(daysUntil: number): string {
  if (daysUntil === 0) return 'today'
  if (daysUntil === 1) return 'tomorrow'
  if (daysUntil === -1) return 'yesterday'
  if (daysUntil > 0 && daysUntil <= 7) return `in ${daysUntil} days`
  if (daysUntil > 7 && daysUntil <= 30) return `in ${Math.ceil(daysUntil / 7)} weeks`
  if (daysUntil < 0 && daysUntil >= -30) return `${Math.abs(daysUntil)} days ago`
  if (daysUntil < 0) return `${Math.abs(Math.round(daysUntil / 30))} months ago`
  return `in ${Math.ceil(daysUntil / 30)} months`
}

export default async function CalendarPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const userId = session.user.id ?? ''
  const isSuperuser = session.user.role === 'superuser'

  const [rawEntries, allCats] = await Promise.all([
    db.select().from(entries).where(
      and(
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isNull(entries.parentEntryId),
      ),
    ),
    db.select().from(categories),
  ])

  const decrypted = decryptEntries(rawEntries)
  const catName = new Map(allCats.map((c) => [c.id, getCategoryLabel(c.slug, c.name)]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()

  const rows: CalendarRow[] = []
  for (const e of decrypted) {
    const cat = catName.get(e.categoryId) ?? '—'
    if (e.isRecurring && e.subscriptionRenewsAt) {
      const d = parseRenewsAt(e.subscriptionRenewsAt)
      if (d) {
        rows.push({
          entryId: e.id,
          title: e.title,
          type: e.type,
          category: cat,
          date: d,
          kind: 'renewal',
          daysUntil: Math.round((d.getTime() - todayMs) / 86_400_000),
          amountCents: e.subscriptionAmountCents,
          period: e.subscriptionPeriod,
        })
      }
    }
    if ((e.type === 'credit_card' || e.type === 'bank_account') && e.expiryDate) {
      const d = parseExpiry(e.expiryDate)
      if (d) {
        rows.push({
          entryId: e.id,
          title: e.title,
          type: e.type,
          category: cat,
          date: d,
          kind: 'expiry',
          daysUntil: Math.round((d.getTime() - todayMs) / 86_400_000),
        })
      }
    }
  }

  // Buckets
  const overdue = rows.filter((r) => r.daysUntil < 0).sort((a, b) => b.daysUntil - a.daysUntil)
  const next7 = rows.filter((r) => r.daysUntil >= 0 && r.daysUntil <= 7).sort((a, b) => a.daysUntil - b.daysUntil)
  const next30 = rows.filter((r) => r.daysUntil > 7 && r.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil)
  const later = rows.filter((r) => r.daysUntil > 30).sort((a, b) => a.daysUntil - b.daysUntil)

  // Monthly subscription burn estimate
  const monthlyCents = rows
    .filter((r) => r.kind === 'renewal' && r.amountCents != null)
    .reduce((sum, r) => {
      const cents = r.amountCents ?? 0
      switch (r.period) {
        case 'month': return sum + cents
        case 'year': return sum + cents / 12
        case 'week': return sum + cents * 4.33
        case 'quarter': return sum + cents / 3
        default: return sum + cents
      }
    }, 0)

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-bold text-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/cobb/icons/system/recurring.png" width={36} height={36} alt="" className="h-9 w-9 object-contain shrink-0" />
          Bills & renewals
          <HelpPopout
            title="Bills & renewals"
            sections={[
              {
                heading: 'What you see',
                tips: [
                  { title: 'Upcoming bills', description: 'Every recurring charge from your subscriptions + auto-pay entries, sorted by next due date.' },
                  { title: 'Renewals', description: 'Documents with renewal-by-date fields (insurance, registration, etc.) surface here so they don\'t lapse.' },
                  { title: 'Total per month', description: 'Roll-up of what monthly subscription cost adds to, including annual bills amortized.' },
                ],
              },
              {
                heading: 'Subscribe externally',
                tips: [
                  { title: 'iCal feed', description: 'Settings → Calendar Feed gives you a webcal:// URL you can subscribe to in Apple Calendar / Google Calendar. Renewals appear in your normal calendar.' },
                  { title: 'Family-wide', description: 'Each user gets their own feed; only items they can see end up in it.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-sm text-stone-400 mt-1">
          Every dated entry — subscriptions, credit-card expirations, anything that&rsquo;ll cost you if you forget about it.
          {monthlyCents > 0 && (
            <>
              {' '}<span className="text-emerald-300">${(monthlyCents / 100).toFixed(2)}/mo</span> in tracked subscriptions.
            </>
          )}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">Nothing dated yet. Add a renewal or expiration date to any entry to see it here.</p>
        </div>
      ) : (
        <div className="space-y-7">
          <Section
            title="Overdue / past"
            description="Already happened — tap Mark handled to roll the renewal forward, or open the entry to attach a receipt first."
            icon={<AlertTriangle size={18} className="text-red-400" />}
            tone="red"
            rows={overdue}
            showMarkHandled
          />
          <Section
            title="Next 7 days"
            description="Imminent — the things you'll get hit with this week."
            icon={<Clock size={18} className="text-amber-400" />}
            tone="amber"
            rows={next7}
          />
          <Section
            title="Next 30 days"
            description="On the horizon."
            icon={<Calendar size={18} className="text-sky-400" />}
            tone="sky"
            rows={next30}
          />
          <Section
            title="Beyond 30 days"
            description="Nothing urgent — but they're tracked."
            icon={<Calendar size={18} className="text-stone-500" />}
            tone="stone"
            rows={later}
          />
        </div>
      )}
    </div>
  )
}

const TONES = {
  red: { border: 'border-red-700/30', bg: 'bg-red-950/20', accent: 'text-red-300' },
  amber: { border: 'border-amber-700/30', bg: 'bg-amber-950/20', accent: 'text-amber-300' },
  sky: { border: 'border-sky-700/30', bg: 'bg-sky-950/20', accent: 'text-sky-300' },
  stone: { border: 'border-stone-700/40', bg: 'bg-stone-900/30', accent: 'text-stone-400' },
} as const

function Section({
  title,
  description,
  icon,
  tone,
  rows,
  showMarkHandled = false,
}: {
  title: string
  description: string
  icon: React.ReactNode
  tone: keyof typeof TONES
  rows: CalendarRow[]
  /** True only for the Overdue bucket — renders a "Mark handled" button
   *  alongside renewal rows so the user can roll the date forward in one
   *  tap without leaving the calendar. */
  showMarkHandled?: boolean
}) {
  if (rows.length === 0) return null
  const t = TONES[tone]
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        {icon}
        <h2 className="text-base font-semibold text-stone-100">
          {title} <span className="text-stone-500 font-normal text-sm">({rows.length})</span>
        </h2>
      </div>
      <p className="text-xs text-stone-500 mb-3">{description}</p>
      <ul className={`space-y-1.5`}>
        {rows.map((r) => (
          <li key={`${r.entryId}:${r.kind}`}>
            {/* Row is a flex container; the Link is the primary clickable
                area (opens the entry), the Mark-handled button sits as a
                sibling so its click doesn't bubble into the Link. */}
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${t.border} ${t.bg} hover:brightness-125 transition`}>
              <Link
                href={`/entries/${r.entryId}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                {r.kind === 'renewal' ? (
                  <Repeat size={14} className={`${t.accent} shrink-0`} />
                ) : (
                  <CreditCard size={14} className={`${t.accent} shrink-0`} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-stone-100 truncate">{r.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-stone-500">{r.category}</span>
                  </div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {r.kind === 'renewal' ? 'Renews' : 'Expires'} {formatDate(r.date)}
                    {' '}<span className={t.accent}>· {relativeWord(r.daysUntil)}</span>
                    {r.amountCents != null && (
                      <span className="text-stone-300"> · {formatAmount(r.amountCents, r.period)}</span>
                    )}
                  </div>
                </div>
              </Link>
              {showMarkHandled && r.kind === 'renewal' && (
                <MarkHandledButton entryId={r.entryId} period={r.period ?? null} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
