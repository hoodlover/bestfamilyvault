import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import {
  entries,
  statementLineItems,
  statementLineDecision,
  recurringSuggestions,
  subcategories,
} from '@/lib/db/schema'
import { and, eq, gte, lte, or, inArray } from 'drizzle-orm'
import { ScaleIcon, Calendar, FileText, CheckCircle2, Repeat, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { decryptEntries } from '@/lib/crypto'
import {
  classifyLine,
  type Classification,
  type InputLine,
  type InputReceipt,
  type InputRecurring,
  type InputDecision,
} from '@/lib/reconcile-classify'
import { LineDecisionActions } from '@/components/ui/line-decision-actions'

// Default to year-to-date — what Lance picked when I asked. Custom ranges
// via ?from=YYYY-MM-DD&to=YYYY-MM-DD; LLC filter via ?llc=<slug>; view
// filter via ?view=unreconciled|recurring|matched|decided|all (default
// unreconciled because that's the actionable bucket).

interface SearchParams {
  from?: string
  to?: string
  llc?: string  // subcategory slug; '' = personal/no-LLC; 'all' = no filter
  view?: string
}

function ytdRange(): { from: string; to: string } {
  // Build YYYY-MM-DD without local-tz drift. UTC year-to-date is fine —
  // GA bank statements post in EST and we're not splitting seconds.
  const now = new Date()
  const year = now.getUTCFullYear()
  const from = `${year}-01-01`
  const to = now.toISOString().slice(0, 10)
  return { from, to }
}

function safeDate(input: string | undefined, fallback: string): string {
  if (!input) return fallback
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : fallback
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${sign}$${whole.toLocaleString()}.${frac}`
}

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const userId = session.user.id

  const params = await searchParams
  const { from: ytdFrom, to: ytdTo } = ytdRange()
  const from = safeDate(params.from, ytdFrom)
  const to = safeDate(params.to, ytdTo)
  const llcFilter = params.llc ?? 'all'
  const view = (params.view ?? 'unreconciled') as
    | 'unreconciled' | 'recurring' | 'matched' | 'cross_llc' | 'decided' | 'all'

  // ─── Pull LLC subcategories (for the chip filter + name resolution) ─
  const allLlcs = await db
    .select({ id: subcategories.id, slug: subcategories.slug, name: subcategories.name })
    .from(subcategories)
    .innerJoin(entries, eq(entries.subcategoryId, subcategories.id))
    // Hack: filter to subcategories under the Receipts category. Cheap
    // because Receipts has < 10 subcategories.
    .groupBy(subcategories.id, subcategories.slug, subcategories.name)
  // Resolve via Receipts category slug instead.
  const llcRows = await db.execute<{ id: string; slug: string; name: string }>(
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Drizzle helper for raw query.
    (await import('drizzle-orm')).sql`
      SELECT s.id, s.slug, s.name
      FROM subcategory s
      JOIN category c ON c.id = s.category_id
      WHERE c.slug = 'receipts'
      ORDER BY s.name ASC
    ` as any,
  )
  type LlcRow = { id: string; slug: string; name: string }
  const llcs: LlcRow[] =
    'rows' in llcRows ? (llcRows as { rows: LlcRow[] }).rows : (llcRows as unknown as LlcRow[])
  void allLlcs

  // Build a slug → id map for the URL filter.
  const llcBySlug = new Map(llcs.map((l: LlcRow) => [l.slug, l]))
  const selectedLlc = llcFilter === 'all' ? null : llcBySlug.get(llcFilter) ?? null

  // ─── Pull all bank/credit-card account entries (for LLC resolution) ─
  // We need a map of accountEntryId → llcSubcategoryId so we can
  // classify lines by LLC. Limit to entries the user can see.
  const isSuperuser = session.user.role === 'superuser'
  const accountEntries = await db
    .select({
      id: entries.id,
      title: entries.title,
      llcSubcategoryId: entries.llcSubcategoryId,
    })
    .from(entries)
    .where(
      and(
        inArray(entries.type, ['bank_account', 'credit_card']),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
  const accountById = new Map(accountEntries.map((a) => [a.id, a]))

  // ─── Pull statement lines in scope ─────────────────────────────────
  // Filter on date range. If an LLC is selected, also restrict to lines
  // whose owning account has that LLC tag (or null, for the "personal"
  // virtual bucket = no LLC).
  const eligibleAccountIds = accountEntries
    .filter((a) => {
      if (!selectedLlc) return true
      if (llcFilter === 'personal') return a.llcSubcategoryId === null
      return a.llcSubcategoryId === selectedLlc.id
    })
    .map((a) => a.id)

  // If no accounts in scope, short-circuit to empty.
  if (eligibleAccountIds.length === 0) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <ReconcileHeader />
        <p className="mt-8 text-sm text-stone-400">
          No bank or credit-card accounts found in this filter. Try changing the LLC selector.
        </p>
      </div>
    )
  }

  const lineRows = await db
    .select()
    .from(statementLineItems)
    .where(
      and(
        eq(statementLineItems.userId, userId),
        inArray(statementLineItems.accountEntryId, eligibleAccountIds),
        gte(statementLineItems.postedDate, from),
        lte(statementLineItems.postedDate, to),
      ),
    )
    .orderBy(statementLineItems.postedDate)

  // ─── Pull approved recurring suggestions (the "ignore noise" signal) ─
  const approvedRecurring = await db
    .select({
      id: recurringSuggestions.id,
      accountEntryId: recurringSuggestions.accountEntryId,
      normalizedMerchant: recurringSuggestions.normalizedMerchant,
    })
    .from(recurringSuggestions)
    .where(
      and(
        eq(recurringSuggestions.userId, userId),
        eq(recurringSuggestions.status, 'approved'),
      ),
    )

  // ─── Pull receipt entries (any LLC — we filter in classification) ───
  // customFields.kind='receipt' is the marker. Limit to entries the
  // user can see.
  const { sql: sqlRaw } = await import('drizzle-orm')
  const receiptRows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'document'),
        sqlRaw`(${entries.customFields} ->> 'kind') = 'receipt'`,
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
  const decryptedReceipts = decryptEntries(receiptRows)
  const receipts: InputReceipt[] = decryptedReceipts.map((e) => {
    const cf = (e.customFields ?? {}) as Record<string, string>
    return {
      id: e.id,
      llcSubcategoryId: e.llcSubcategoryId ?? null,
      totalCents: parseInt(cf.totalCents ?? '0', 10) || 0,
      purchaseDate: cf.purchaseDate ?? null,
      merchant: cf.merchant ?? null,
      normalizedMerchant: null, // not used in matching yet
    }
  })

  // ─── Pull explicit decisions for these lines ────────────────────────
  const lineIds = lineRows.map((l) => l.id)
  const decisionRows = lineIds.length > 0
    ? await db
        .select()
        .from(statementLineDecision)
        .where(inArray(statementLineDecision.statementLineItemId, lineIds))
    : []
  const decisions = new Map<string, InputDecision>()
  for (const d of decisionRows) {
    decisions.set(d.statementLineItemId, {
      statementLineItemId: d.statementLineItemId,
      decision: d.decision,
      receiptEntryId: d.receiptEntryId,
      note: d.note,
    })
  }

  // ─── Classify every line ───────────────────────────────────────────
  const recurringsInput: InputRecurring[] = approvedRecurring.map((r) => ({
    id: r.id,
    accountEntryId: r.accountEntryId,
    normalizedMerchant: r.normalizedMerchant,
  }))

  const classified = lineRows.map((line) => {
    const account = accountById.get(line.accountEntryId)
    const lineInput: InputLine = {
      id: line.id,
      accountEntryId: line.accountEntryId,
      postedDate: line.postedDate,
      amountCents: line.amountCents,
      normalizedMerchant: line.normalizedMerchant,
      llcSubcategoryId: account?.llcSubcategoryId ?? null,
    }
    return {
      line,
      account,
      classification: classifyLine(lineInput, recurringsInput, receipts, decisions),
    }
  })

  // ─── Summary stats ─────────────────────────────────────────────────
  let totalDebit = 0
  let recurringCovered = 0
  let receiptCovered = 0
  let crossLlcTotal = 0
  let crossLlcCount = 0
  let decidedTotal = 0
  let unreconciledTotal = 0
  let unreconciledCount = 0
  for (const { line, classification } of classified) {
    const abs = Math.abs(line.amountCents)
    // Only count debits (negative amounts) toward "spend" — credits are
    // deposits/refunds and don't need reconciling against receipts.
    if (line.amountCents >= 0) continue
    totalDebit += abs
    if (classification.kind === 'recurring') recurringCovered += abs
    else if (classification.kind === 'receipt_matched') receiptCovered += abs
    else if (classification.kind === 'cross_llc_matched') {
      crossLlcTotal += abs
      crossLlcCount += 1
    } else if (classification.kind === 'decided') decidedTotal += abs
    else if (classification.kind === 'unreconciled') {
      unreconciledTotal += abs
      unreconciledCount += 1
    }
  }

  // ─── Filter view ───────────────────────────────────────────────────
  const filtered = classified.filter(({ classification }) => {
    if (view === 'all') return true
    if (view === 'unreconciled') return classification.kind === 'unreconciled'
    if (view === 'recurring') return classification.kind === 'recurring'
    if (view === 'matched') return classification.kind === 'receipt_matched'
    if (view === 'cross_llc') return classification.kind === 'cross_llc_matched'
    if (view === 'decided') return classification.kind === 'decided'
    return true
  })

  // Newest first inside each filter — most recent transactions tend to be
  // freshest in Lance's head.
  filtered.reverse()

  // Receipt-id → entry mapping for the "view receipt" link on
  // receipt_matched / matched-decision rows.
  const receiptById = new Map(decryptedReceipts.map((r) => [r.id, r]))

  // LLC name lookup for the row badge.
  const llcById = new Map(llcs.map((l: LlcRow) => [l.id, l]))

  // The same LLC list, including a "personal/no-LLC" virtual bucket so
  // Lance can filter the personal account 0202.
  const llcOptions: Array<{ slug: string; name: string }> = [
    { slug: 'all', name: 'All accounts' },
    ...llcs.map((l: LlcRow) => ({ slug: l.slug, name: l.name })),
    { slug: 'personal', name: 'Personal (no LLC)' },
  ]

  function viewHref(nextView: typeof view): string {
    const u = new URLSearchParams()
    if (from !== ytdFrom) u.set('from', from)
    if (to !== ytdTo) u.set('to', to)
    if (llcFilter !== 'all') u.set('llc', llcFilter)
    if (nextView !== 'unreconciled') u.set('view', nextView)
    const qs = u.toString()
    return qs ? `/reconcile?${qs}` : '/reconcile'
  }

  function llcHref(slug: string): string {
    const u = new URLSearchParams()
    if (from !== ytdFrom) u.set('from', from)
    if (to !== ytdTo) u.set('to', to)
    if (slug !== 'all') u.set('llc', slug)
    if (view !== 'unreconciled') u.set('view', view)
    const qs = u.toString()
    return qs ? `/reconcile?${qs}` : '/reconcile'
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <ReconcileHeader />

      {/* Date range form — wraps to two rows on mobile */}
      <form className="mt-4 flex flex-wrap items-end gap-3" action="/reconcile">
        <div>
          <label className="block text-[11px] font-medium text-stone-500 mb-1 uppercase tracking-wider">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-stone-500 mb-1 uppercase tracking-wider">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="px-3 py-1.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
          />
        </div>
        {llcFilter !== 'all' && <input type="hidden" name="llc" value={llcFilter} />}
        {view !== 'unreconciled' && <input type="hidden" name="view" value={view} />}
        <button
          type="submit"
          className="px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          Apply
        </button>
        <span className="text-[11px] text-stone-500 ml-auto">
          Default: year-to-date
        </span>
      </form>

      {/* LLC filter chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {llcOptions.map((o) => (
          <Link
            key={o.slug}
            href={llcHref(o.slug)}
            className={
              o.slug === llcFilter
                ? 'inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-600 text-white'
                : 'inline-flex items-center px-2.5 py-1 text-xs text-stone-300 bg-stone-800 hover:bg-stone-700 rounded-full transition'
            }
          >
            {o.name}
          </Link>
        ))}
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-6 gap-2">
        <SummaryCard icon={<ScaleIcon size={14} />} label="Total spend" value={formatCents(totalDebit)} tone="default" />
        <SummaryCard icon={<Repeat size={14} />} label="Recurring" value={formatCents(recurringCovered)} tone="emerald" />
        <SummaryCard icon={<FileText size={14} />} label="Receipt-matched" value={formatCents(receiptCovered)} tone="emerald" />
        <SummaryCard
          icon={<AlertCircle size={14} />}
          label={`Cross-LLC (${crossLlcCount})`}
          value={formatCents(crossLlcTotal)}
          tone="orange"
        />
        <SummaryCard icon={<CheckCircle2 size={14} />} label="Decided" value={formatCents(decidedTotal)} tone="emerald" />
        <SummaryCard
          icon={<AlertCircle size={14} />}
          label={`Unreconciled (${unreconciledCount})`}
          value={formatCents(unreconciledTotal)}
          tone="amber"
        />
      </div>

      {/* View chips */}
      <div className="mt-5 flex flex-wrap gap-1.5 border-b border-stone-800 pb-3">
        <ViewChip href={viewHref('unreconciled')} active={view === 'unreconciled'} label="Unreconciled" />
        <ViewChip href={viewHref('recurring')} active={view === 'recurring'} label="Recurring" />
        <ViewChip href={viewHref('matched')} active={view === 'matched'} label="Receipt-matched" />
        {crossLlcCount > 0 && (
          <ViewChip href={viewHref('cross_llc')} active={view === 'cross_llc'} label={`Cross-LLC (${crossLlcCount})`} />
        )}
        <ViewChip href={viewHref('decided')} active={view === 'decided'} label="Decided" />
        <ViewChip href={viewHref('all')} active={view === 'all'} label="All" />
      </div>

      {/* Line table */}
      <div className="mt-4">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-500">
            {view === 'unreconciled' ? (
              <>
                <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-400" />
                <p className="font-medium text-stone-300">Nothing unreconciled in this range.</p>
                <p className="mt-1">Either everything has a receipt or is on the recurring list, or there are no transactions in scope.</p>
              </>
            ) : (
              <p>No lines in this view.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map(({ line, account, classification }) => (
              <LineRow
                key={line.id}
                line={line}
                accountTitle={account?.title ?? 'Unknown account'}
                accountLlcName={account?.llcSubcategoryId ? llcById.get(account.llcSubcategoryId)?.name ?? null : null}
                classification={classification}
                receiptTitle={
                  classification.receiptEntryId
                    ? receiptById.get(classification.receiptEntryId)?.title ?? null
                    : null
                }
                receiptLlcName={
                  classification.receiptLlcSubcategoryId
                    ? llcById.get(classification.receiptLlcSubcategoryId)?.name ?? null
                    : null
                }
              />
            ))}
          </div>
        )}
      </div>

      {filtered.length >= 25 && (
        <p className="mt-6 text-[11px] text-stone-500 text-center">
          Showing all {filtered.length} matching lines. Use the date range or LLC filter to narrow.
        </p>
      )}
    </div>
  )
}

function ReconcileHeader() {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/cobb/icons/system/reconciled.png"
        alt=""
        className="h-12 w-12 shrink-0 object-contain rounded-xl"
      />
      <div>
        <h1 className="text-2xl font-bold text-stone-100">Reconcile</h1>
        <p className="text-sm text-stone-400 mt-0.5">
          Match receipts to statement charges. The unreconciled list is what to chase for 1120-S / 1040 prep.
        </p>
      </div>
    </div>
  )
}

function SummaryCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'default' | 'emerald' | 'amber' | 'orange'
}) {
  const styles =
    tone === 'amber'
      ? 'border-amber-700/50 bg-amber-950/30'
      : tone === 'orange'
        ? 'border-orange-700/50 bg-orange-950/30'
        : tone === 'emerald'
          ? 'border-stone-700 bg-stone-900/40'
          : 'border-stone-700 bg-stone-900/40'
  const valueColor =
    tone === 'amber' ? 'text-amber-200'
      : tone === 'orange' ? 'text-orange-200'
        : 'text-stone-100'
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${styles}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-stone-400 uppercase tracking-wider">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-base font-semibold mt-1 ${valueColor}`}>{value}</p>
    </div>
  )
}

function ViewChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white'
          : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800 rounded-lg transition'
      }
    >
      {label}
    </Link>
  )
}

function LineRow({
  line,
  accountTitle,
  accountLlcName,
  classification,
  receiptTitle,
  receiptLlcName,
}: {
  line: {
    id: string
    postedDate: string
    rawDescription: string
    normalizedMerchant: string
    amountCents: number
  }
  accountTitle: string
  accountLlcName: string | null
  classification: Classification
  receiptTitle: string | null
  receiptLlcName: string | null
}) {
  const isDebit = line.amountCents < 0
  const amount = formatCents(line.amountCents)

  const badge = (() => {
    switch (classification.kind) {
      case 'recurring':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-800 border border-stone-700 text-stone-300">
            <Repeat size={10} /> Recurring
          </span>
        )
      case 'receipt_matched':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/50 border border-emerald-800/50 text-emerald-300">
            <FileText size={10} /> Receipt
          </span>
        )
      case 'cross_llc_matched':
        return (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-950/50 border border-orange-700/50 text-orange-200"
            title="Receipt found but filed under a different LLC than this card's"
          >
            <AlertCircle size={10} /> Cross-LLC
          </span>
        )
      case 'decided':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/30 border border-emerald-700/40 text-emerald-300">
            <CheckCircle2 size={10} /> {classification.decision?.replace(/_/g, ' ')}
          </span>
        )
      case 'unreconciled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-900/40 border border-amber-700/40 text-amber-200">
            <AlertCircle size={10} /> Unreconciled
          </span>
        )
    }
  })()

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 hover:bg-stone-900/70 transition px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="text-right shrink-0">
          <p className={`text-sm font-semibold ${isDebit ? 'text-stone-100' : 'text-emerald-300'}`}>
            {amount}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">
            <Calendar size={11} className="inline mr-0.5" />
            {line.postedDate}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-stone-200 truncate">
              {line.normalizedMerchant || <em className="text-stone-400 not-italic">{line.rawDescription.slice(0, 40)}</em>}
            </p>
            {badge}
          </div>
          <p className="text-xs text-stone-400 truncate mt-0.5">
            {accountTitle}
            {accountLlcName && <span className="ml-2 text-stone-400">· {accountLlcName}</span>}
          </p>
          {receiptTitle && (
            <p
              className={
                'text-xs truncate mt-0.5 ' +
                (classification.kind === 'cross_llc_matched'
                  ? 'text-orange-300'
                  : 'text-emerald-400')
              }
            >
              <FileText size={11} className="inline mr-1" />
              {receiptTitle}
              {classification.kind === 'cross_llc_matched' && receiptLlcName && (
                <span className="ml-2 text-orange-200">
                  · filed as {receiptLlcName}, paid on {accountLlcName ?? 'personal'} card
                </span>
              )}
            </p>
          )}
          {classification.kind === 'decided' && classification.decisionNote && (
            <p className="text-xs text-stone-300 italic mt-0.5">"{classification.decisionNote}"</p>
          )}
        </div>
        <LineDecisionActions
          lineId={line.id}
          amountCents={line.amountCents}
          postedDate={line.postedDate}
          rawDescription={line.rawDescription}
          currentDecision={classification.kind === 'decided' ? classification.decision ?? null : null}
        />
      </div>
    </div>
  )
}

// Suppress unused import warning
void ChevronLeft
void ChevronRight
