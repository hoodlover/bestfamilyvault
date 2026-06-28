import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, recurringSuggestions, subcategories } from '@/lib/db/schema'
import { HelpPopout } from '@/components/ui/help-popout'
import { and, eq, or, isNull, desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { Repeat, Plus, ExternalLink, Sparkles } from 'lucide-react'
import { decryptEntries } from '@/lib/crypto'
import { ensureSubscriptionsSubcategory } from '@/lib/actions/family-setup'
import { RecurringRowRemoveButton } from '@/components/ui/recurring-row-remove-button'
import { SuggestionRowActions } from '@/components/ui/suggestion-row-actions'

interface SearchParams {
  tab?: string
  sort?: string
}

// Sort modes for the tracked-recurring list. URL-driven so a refresh
// preserves the choice and links can deep-link to a specific order.
const SORT_MODES = ['name', 'renews', 'amount', 'type'] as const
type SortMode = typeof SORT_MODES[number]
const SORT_LABEL: Record<SortMode, string> = {
  name: 'Name',
  renews: 'Renews next',
  amount: 'Cost',
  type: 'Payment type',
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'
  const params = await searchParams
  const tab = params.tab === 'suggested' ? 'suggested' : 'tracked'
  const sortMode: SortMode = (SORT_MODES as readonly string[]).includes(params.sort ?? '')
    ? (params.sort as SortMode)
    : 'name'

  // Idempotently seed the Subscriptions subcategory under Finance so the
  // "+ New subscription" CTA below has a sensible landing place.
  const seedResult = await ensureSubscriptionsSubcategory()
  const subcategoryId = seedResult && 'subId' in seedResult ? seedResult.subId : null

  // Pull every entry flagged as recurring, regardless of category. This lets
  // a Netflix login stay filed under Entertainment AND show up here without
  // duplicating the entry.
  const raw = await db.select().from(entries).where(
    and(
      eq(entries.isRecurring, true),
      or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      isSuperuser ? undefined : eq(entries.isPrivate, false),
      isNull(entries.parentEntryId),
    )
  ).orderBy(desc(entries.updatedAt))
  const decrypted = decryptEntries(raw)
  // Apply the URL-driven sort. Name + type are alpha, renews orders by
  // upcoming date with missing dates at the bottom so Lance can spot
  // entries that need a date set; amount orders highest cost first so
  // big-ticket items pop. monthlyEquivalent normalizes yearly to monthly
  // so a $120/yr Spotify sub compares against a $10/mo Netflix sub.
  function monthlyEquivalent(cents: number | null, period: string | null): number {
    if (cents == null) return 0
    if (period === 'yearly') return Math.round(cents / 12)
    return cents
  }
  const rows = [...decrypted].sort((a, b) => {
    if (sortMode === 'name') return a.title.localeCompare(b.title)
    if (sortMode === 'renews') {
      const ad = a.subscriptionRenewsAt ?? ''
      const bd = b.subscriptionRenewsAt ?? ''
      // Missing renewal dates sink to the bottom — they're the rows Lance
      // wants to notice and fill in.
      if (!ad && !bd) return a.title.localeCompare(b.title)
      if (!ad) return 1
      if (!bd) return -1
      return ad.localeCompare(bd)
    }
    if (sortMode === 'amount') {
      return monthlyEquivalent(b.subscriptionAmountCents, b.subscriptionPeriod)
        - monthlyEquivalent(a.subscriptionAmountCents, a.subscriptionPeriod)
    }
    // 'type' — group by underlying entry.type (login, credit_card, bank
    // account, etc.). Within each type, alpha by title.
    if (a.type !== b.type) return (a.type ?? '').localeCompare(b.type ?? '')
    return a.title.localeCompare(b.title)
  })

  const totalUnseen = rows.length

  // Pending suggestions — surfaced via the Suggested tab. Sorted personal-
  // first (null LLC), then by LLC name; within each group, by descending
  // amount so the bigger merchants jump first.
  const pendingSuggestions = await db
    .select({
      id: recurringSuggestions.id,
      displayName: recurringSuggestions.displayName,
      typicalAmountCents: recurringSuggestions.typicalAmountCents,
      period: recurringSuggestions.period,
      firstSeenAt: recurringSuggestions.firstSeenAt,
      lastSeenAt: recurringSuggestions.lastSeenAt,
      occurrenceCount: recurringSuggestions.occurrenceCount,
      predictedNextAt: recurringSuggestions.predictedNextAt,
      llcName: subcategories.name,
      accountTitle: entries.title,
    })
    .from(recurringSuggestions)
    .leftJoin(subcategories, eq(subcategories.id, recurringSuggestions.llcSubcategoryId))
    .leftJoin(entries, eq(entries.id, recurringSuggestions.accountEntryId))
    .where(
      and(
        eq(recurringSuggestions.userId, userId),
        eq(recurringSuggestions.status, 'pending'),
      ),
    )
    .orderBy(asc(subcategories.name), desc(recurringSuggestions.typicalAmountCents))

  const suggestedCount = pendingSuggestions.length

  // Sum monthly equivalent across entries that have an amount + period.
  // One-time entries are excluded (they're not recurring spend).
  let monthlyTotal: number | null = null
  for (const r of rows) {
    if (r.subscriptionAmountCents == null) continue
    if (r.subscriptionPeriod === 'monthly') monthlyTotal = (monthlyTotal ?? 0) + r.subscriptionAmountCents
    else if (r.subscriptionPeriod === 'yearly') monthlyTotal = (monthlyTotal ?? 0) + Math.round(r.subscriptionAmountCents / 12)
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      {/* Compact mobile header (md:hidden) — title + mono count + small
          add-subscription icon. Matches the universal utility-page chrome
          used on Receipts / Recipes / Notes / Cards. Monthly roll-up,
          tabs, and the rest of the page body render the same on both
          breakpoints below. */}
      <div className="md:hidden flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Subscriptions</h1>
        <span className="text-xs font-mono text-stone-500">{totalUnseen}</span>
        {subcategoryId && (
          <Link
            href={`/entries/new?type=login&subcategoryId=${subcategoryId}`}
            aria-label="New subscription"
            className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/recurring.png"
              width={40}
              height={40}
              alt=""
              className="h-10 w-10 object-contain"
              style={{ filter: 'brightness(1.08) saturate(1.05)' }}
            />
          </Link>
        )}
      </div>

      <div className="hidden md:flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
            <Repeat size={20} className="text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">Subscriptions</h1>
              <HelpPopout
                title="Subscriptions"
                sections={[
                  {
                    heading: 'Auto-discovery',
                    tips: [
                      { title: 'Bank entries flag themselves', description: 'When you save a bank entry with autopay info, it shows up here too without re-typing. The same row stays in its original category.' },
                      { title: 'Recurring toggle', description: 'Any entry with the recurring flag (login, document, etc.) lands on this page.' },
                    ],
                  },
                  {
                    heading: 'Track + manage',
                    tips: [
                      { title: 'Paid With', description: 'Each subscription can be linked to the card / account that pays it — clicking jumps you to that entry.' },
                      { title: 'Monthly cost', description: 'Add an amount + cadence; the top widget rolls everything up to monthly.' },
                      { title: 'Renewal dates', description: 'Add next-renewal dates to surface them on the /calendar page and iCal feed.' },
                    ],
                  },
                  {
                    heading: 'Remove',
                    tips: [
                      { title: 'Just untick recurring', description: 'Edit the underlying entry and clear the recurring flag — the entry stays put, just drops off this page. Avoids the dup-entry pattern.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              Recurring auto-pay charges. {totalUnseen} on file.
            </p>
          </div>
        </div>
        {subcategoryId && (
          <Link
            href={`/entries/new?type=login&subcategoryId=${subcategoryId}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
          >
            <Plus size={14} />
            New subscription
          </Link>
        )}
      </div>

      {/* Tabs — surface the Suggested queue when there's anything pending,
          or always when the user followed the cron's push link to ?tab=suggested. */}
      {(suggestedCount > 0 || tab === 'suggested') && (
        <div className="mb-5 flex items-center gap-1 border-b border-stone-800">
          <Link
            href="/subscriptions"
            className={
              tab === 'tracked'
                ? 'px-4 py-2 text-sm font-medium text-emerald-300 border-b-2 border-emerald-500 -mb-px'
                : 'px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-300 transition'
            }
          >
            Tracked ({totalUnseen})
          </Link>
          <Link
            href="/subscriptions?tab=suggested"
            className={
              tab === 'suggested'
                ? 'px-4 py-2 text-sm font-medium text-emerald-300 border-b-2 border-emerald-500 -mb-px inline-flex items-center gap-1.5'
                : 'px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-300 transition inline-flex items-center gap-1.5'
            }
          >
            <Sparkles size={13} />
            Suggested ({suggestedCount})
          </Link>
        </div>
      )}

      {tab === 'tracked' && (
        <div className="mb-5 p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-xs text-amber-200 leading-relaxed">
          When a credit card gets compromised, this is the list of &ldquo;what&rsquo;s going to fail.&rdquo;
          Add the renewal date and cancellation URL to each entry&rsquo;s notes — when something
          breaks, that&rsquo;s the only place you&rsquo;ll be able to find &quot;how do I stop this charge&quot;
          in a hurry.
        </div>
      )}

      {tab === 'suggested' && (
        <div className="mb-5">
          {pendingSuggestions.length === 0 ? (
            <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
              <p className="text-sm">No suggestions right now.</p>
              <p className="text-xs mt-1">
                The detector runs weekly. Drop fresh statements in your Vault File Drop folder and they&rsquo;ll be parsed on the next import.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-stone-700/50 bg-stone-800/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-stone-200 truncate">
                        {s.displayName}
                      </div>
                      <div className="text-xs font-mono text-emerald-300 shrink-0">
                        {formatBillingAmount(Math.abs(s.typicalAmountCents), s.period)}
                      </div>
                    </div>
                    <div className="mt-0.5 text-xs text-stone-500 truncate flex items-center gap-1.5 flex-wrap">
                      <span>{s.occurrenceCount}× since {s.firstSeenAt.slice(0, 7)}</span>
                      <span className="text-stone-700">·</span>
                      <span>next ~{s.predictedNextAt}</span>
                      <span className="text-stone-700">·</span>
                      <span className="text-stone-400">{s.accountTitle ?? 'unknown account'}</span>
                      {s.llcName && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/40 text-emerald-300 text-[10px] uppercase tracking-wider">
                          {s.llcName}
                        </span>
                      )}
                    </div>
                  </div>
                  <SuggestionRowActions suggestionId={s.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'tracked' && rows.length === 0 && (
        <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">No recurring bills tracked yet.</p>
          <p className="text-xs mt-1">Open any entry and tap &ldquo;Mark as recurring&rdquo; to add it here without moving it from its category.</p>
          {subcategoryId && (
            <Link
              href={`/entries/new?type=login&subcategoryId=${subcategoryId}`}
              className="mt-3 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition"
            >
              + Or create a new subscription entry
            </Link>
          )}
        </div>
      )}

      {tab === 'tracked' && rows.length > 0 && (
        <>
          {/* Sort pill row — URL-driven so refresh / back-button keeps the
              user's pick. The pills mirror the segmented-tab visual from
              the meal-plan area. Lance flagged that he needed to scan by
              payment type to see which cards / accounts he's still paying
              from, and by renew date to spot the ones missing a date. */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Sort</span>
            {SORT_MODES.map((mode) => {
              const isActive = mode === sortMode
              const href = mode === 'name' ? '/subscriptions' : `/subscriptions?sort=${mode}`
              return (
                <Link
                  key={mode}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'px-2.5 py-1 rounded-full text-[11px] font-semibold transition'
                      : 'px-2.5 py-1 rounded-full text-[11px] font-medium text-stone-400 bg-stone-900/40 border border-stone-700/40 hover:text-stone-200 transition'
                  }
                  // Inline style for the active pill — bypasses any
                  // cached-CSS issue (Tailwind utility lookups depend
                  // on the latest CSS chunk being present). See
                  // MealPlanTabs for the same pattern.
                  style={
                    isActive
                      ? {
                          backgroundColor: 'rgb(var(--accent-500))',
                          color: 'white',
                          boxShadow:
                            '0 0 0 2px rgb(var(--accent-300) / 0.65), 0 4px 14px rgb(var(--accent-400) / 0.45)',
                        }
                      : undefined
                  }
                >
                  {SORT_LABEL[mode]}
                </Link>
              )
            })}
          </div>

        <div className="space-y-2">
          {rows.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-stone-700/50 bg-stone-800/40 hover:border-stone-600 hover:bg-stone-800 transition"
            >
              <Link href={`/entries/${e.id}`} className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-stone-200 truncate">{e.title}</div>
                  {formatBillingAmount(e.subscriptionAmountCents, e.subscriptionPeriod) && (
                    <div className="text-xs font-mono text-emerald-300 shrink-0">
                      {formatBillingAmount(e.subscriptionAmountCents, e.subscriptionPeriod)}
                    </div>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-stone-500 truncate flex items-center gap-1.5 flex-wrap">
                  {e.username || <span className="text-stone-600">no username</span>}
                  {e.url && (
                    <>
                      <span className="text-stone-700">·</span>
                      <span className="text-stone-400">{stripProtocol(e.url)}</span>
                    </>
                  )}
                  {e.subscriptionRenewsAt ? (
                    <>
                      <span className="text-stone-700">·</span>
                      <span className={isRenewingSoon(e.subscriptionRenewsAt) ? 'text-amber-300' : 'text-stone-400'}>
                        renews {formatRenewDate(e.subscriptionRenewsAt)}
                      </span>
                    </>
                  ) : (
                    // Surface the gap so Lance can spot recurring entries
                    // that don't yet have a renewal date set. The italic
                    // amber treatment lines up with the "needs input"
                    // language used elsewhere in the app.
                    <>
                      <span className="text-stone-700">·</span>
                      <span className="text-amber-500/80 italic">no renewal date — add one</span>
                    </>
                  )}
                </div>
              </Link>
              {e.url && (
                <Link href={`/entries/${e.id}`} className="shrink-0 text-stone-500 hover:text-stone-300 transition">
                  <ExternalLink size={14} />
                </Link>
              )}
              <RecurringRowRemoveButton entryId={e.id} title={e.title} />
            </div>
          ))}
        </div>
        </>
      )}

      {tab === 'tracked' && monthlyTotal != null && (
        <p className="mt-4 text-right text-xs text-stone-500">
          Estimated monthly equivalent across all entries with amounts:{' '}
          <span className="text-stone-300 font-mono">${(monthlyTotal / 100).toFixed(2)}</span>
        </p>
      )}
    </div>
  )
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')
}

function formatBillingAmount(cents: number | null, period: string | null): string | null {
  if (cents == null) return null
  const dollars = (cents / 100).toFixed(2)
  if (period === 'monthly') return `$${dollars}/mo`
  if (period === 'yearly') return `$${dollars}/yr`
  if (period === 'one_time') return `$${dollars} (once)`
  return `$${dollars}`
}

function formatRenewDate(iso: string): string {
  // Stored as YYYY-MM-DD; render as "Mar 14" or "Mar 14, 2027" depending on year.
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return iso
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function isRenewingSoon(iso: string): boolean {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return false
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return false
  const days = (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 14
}
