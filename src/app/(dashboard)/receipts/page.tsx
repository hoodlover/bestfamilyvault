import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories, entries } from '@/lib/db/schema'
import { eq, and, or, isNull, asc } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { CobbBanner } from '@/components/ui/cobb-banner'
import { HelpPopout } from '@/components/ui/help-popout'

// Receipts at-a-glance. Tile per LLC subcategory under the Receipts
// category. Each tile shows YTD total (calendar year) + receipt count,
// sorted by YTD spend descending so the busiest LLC is first. The
// existing /categories/receipts?sub=<id> page handles drill-down — this
// landing is purely the summary roll-up.

interface LlcStat {
  subId: string
  subName: string
  subSlug: string
  ytdCents: number
  lifetimeCents: number
  ytdCount: number
  lifetimeCount: number
  latestDate: string | null
}

interface ReceiptCustom {
  kind?: string
  totalCents?: string
  purchaseDate?: string
}

export default async function ReceiptsOverviewPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const isSuperuser = session.user.role === 'superuser'
  const userId = session.user.id

  const receiptsCat = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, 'receipts'))
    .then((r) => r[0])

  if (!receiptsCat) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-stone-300">
        <h1 className="text-2xl font-bold mb-2">Receipts</h1>
        <p className="text-stone-400">
          The Receipts category hasn&rsquo;t been seeded yet. Run{' '}
          <code className="px-1.5 py-0.5 bg-stone-800 rounded text-emerald-300 text-sm">
            npx tsx --env-file=.env.local scripts/seed-receipts-llcs.ts
          </code>{' '}
          to create it.
        </p>
      </div>
    )
  }

  const [subs, rawEntries] = await Promise.all([
    db
      .select()
      .from(subcategories)
      .where(eq(subcategories.categoryId, receiptsCat.id))
      .orderBy(asc(subcategories.sortOrder)),
    db
      .select({
        id: entries.id,
        title: entries.title,
        subcategoryId: entries.subcategoryId,
        customFields: entries.customFields,
      })
      .from(entries)
      .where(
        and(
          eq(entries.categoryId, receiptsCat.id),
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        ),
      ),
  ])

  // Aggregate per subcategory. The totalCents lives on customFields as a
  // string (custom_fields is jsonb typed Record<string,string>); skip
  // anything that doesn't parse cleanly so a stray legacy row can't
  // poison the total.
  const yearStart = `${new Date().getFullYear()}-01-01`
  const statsBySub = new Map<string, LlcStat>()
  for (const sub of subs) {
    statsBySub.set(sub.id, {
      subId: sub.id,
      subName: sub.name,
      subSlug: sub.slug,
      ytdCents: 0,
      lifetimeCents: 0,
      ytdCount: 0,
      lifetimeCount: 0,
      latestDate: null,
    })
  }

  let grandYtd = 0
  let grandLifetime = 0
  let grandYtdCount = 0

  for (const e of rawEntries) {
    if (!e.subcategoryId) continue
    const stat = statsBySub.get(e.subcategoryId)
    if (!stat) continue
    const cf = (e.customFields ?? {}) as ReceiptCustom
    if (cf.kind !== 'receipt') continue
    const cents = Number(cf.totalCents)
    if (!Number.isFinite(cents)) continue
    const date = typeof cf.purchaseDate === 'string' ? cf.purchaseDate : null

    stat.lifetimeCents += cents
    stat.lifetimeCount += 1
    if (date && date >= yearStart) {
      stat.ytdCents += cents
      stat.ytdCount += 1
    }
    if (date && (!stat.latestDate || date > stat.latestDate)) {
      stat.latestDate = date
    }
    grandLifetime += cents
    if (date && date >= yearStart) {
      grandYtd += cents
      grandYtdCount += 1
    }
  }

  // Sort tiles by YTD descending — busiest LLC first. LLCs with zero YTD
  // fall to the bottom in name order so they're still visible (you'd
  // want to know which LLCs you HAVEN'T captured anything for yet).
  const tiles = [...statsBySub.values()].sort((a, b) => {
    if (b.ytdCents !== a.ytdCents) return b.ytdCents - a.ytdCents
    return a.subName.localeCompare(b.subName)
  })

  const year = new Date().getFullYear()

  // Total receipt count across all LLCs YTD — drives the "43 receipts
  // across 3 books" sub line in the mobile hero card. Books-with-receipts
  // count avoids saying "across 5 books" when only 3 have YTD activity.
  const booksWithYtd = tiles.filter((t) => t.ytdCount > 0).length

  // Recent receipts feed — top 5 captures across all LLCs, newest first.
  // Re-using the same rawEntries scan so we don't pay a second DB query.
  // Spec calls for a Recent section with store / "LLC · date" / mono amount.
  const subNameById = new Map<string, string>(subs.map((s) => [s.id, s.name]))
  const recent = rawEntries
    .map((e) => {
      const cf = (e.customFields ?? {}) as ReceiptCustom
      if (cf.kind !== 'receipt') return null
      const cents = Number(cf.totalCents)
      const date = typeof cf.purchaseDate === 'string' ? cf.purchaseDate : null
      if (!Number.isFinite(cents) || !date) return null
      return {
        id: e.id,
        title: e.title,
        date,
        cents,
        llcName: e.subcategoryId ? subNameById.get(e.subcategoryId) ?? '—' : '—',
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (b.date.localeCompare(a.date)))
    .slice(0, 5)

  return (
    <div className="vault-page">
      <CobbBanner compact />

      {/* ───────────────── Mobile redesign (md:hidden) ─────────────────
          Spec-faithful single-column flow:
            · Title row with the small "Add receipt" icon button
            · Hero card — receipts icon + "SPENT THIS YEAR" + mono total
            · Full-width Snap-a-receipt CTA + "Snap, read, file." hint
            · BY BOOK kicker + vertical card-row list per LLC
          Desktop keeps the existing 3-stat strip + tile grid below
          (wrapped in hidden md:block). */}
      <div className="md:hidden">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Receipts</h1>
          <Link
            href="/receipts/new"
            aria-label="Add receipt"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-800/80 border border-stone-700 text-stone-200 active:scale-95 transition"
          >
            <Plus size={18} />
          </Link>
        </div>

        <section
          className="vault-card rounded-2xl p-4 flex items-center gap-4"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/Finances/receipts.png"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 object-contain shrink-0"
            style={{ filter: 'brightness(1.08) saturate(1.05)' }}
          />
          <div className="min-w-0 flex-1">
            <div className="cv-kicker">Spent this year</div>
            <div className="font-mono text-[27px] font-semibold leading-tight text-stone-100 mt-1">
              {formatDollars(grandYtd)}
            </div>
            <div className="text-xs text-stone-400 mt-0.5">
              {grandYtdCount} receipt{grandYtdCount === 1 ? '' : 's'} across {booksWithYtd} book{booksWithYtd === 1 ? '' : 's'}
            </div>
          </div>
        </section>

        <div className="mt-4 mb-6">
          <Link
            href="/receipts/new"
            className="flex items-center justify-center w-full h-12 rounded-xl bg-accent-600 hover:bg-accent-500 text-white text-sm font-semibold transition active:scale-[0.97]"
          >
            Snap a receipt
          </Link>
          <p className="mt-2 text-center text-xs text-stone-500">Snap, read, file.</p>
        </div>

        <section>
          <h2 className="cv-kicker mb-3">By book</h2>
          <div className="flex flex-col gap-2.5">
            {tiles.map((t) => (
              <Link
                key={t.subId}
                href={`/categories/${receiptsCat.slug}?sub=${t.subId}`}
                className="vault-card vault-card-hover flex items-center gap-3 rounded-xl p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-stone-100 truncate">{t.subName}</div>
                  <div className="text-xs text-stone-400 mt-0.5">
                    {t.ytdCount} receipt{t.ytdCount === 1 ? '' : 's'}
                    {t.latestDate ? ` · last ${t.latestDate}` : ''}
                  </div>
                </div>
                <span className="font-mono text-sm text-stone-200 shrink-0">
                  {formatDollars(t.ytdCents)}
                </span>
                <ChevronRight size={16} className="text-stone-500 shrink-0" aria-hidden />
              </Link>
            ))}
          </div>
          {tiles.length === 0 && (
            <div className="rounded-2xl border border-dashed border-stone-700 p-6 text-center text-stone-400 text-sm">
              No LLC subcategories found. Run the seed script to create them.
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section className="mt-6">
            <h2 className="cv-kicker mb-3">Recent</h2>
            <div className="vault-card rounded-xl divide-y divide-stone-800/60 overflow-hidden">
              {recent.map((r) => (
                <Link
                  key={r.id}
                  href={`/entries/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-stone-100 truncate">{r.title}</div>
                    <div className="text-xs text-stone-400 mt-0.5 truncate">
                      {r.llcName} · {r.date}
                    </div>
                  </div>
                  <span className="font-mono text-sm text-stone-200 shrink-0">
                    {formatDollars(r.cents)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ───────────────── Desktop layout (hidden on mobile) ───────────── */}
      <div className="hidden md:block">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-stone-100 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/Finances/receipts.png"
              alt=""
              className="h-8 w-8 md:h-9 md:w-9 shrink-0 object-contain"
            />
            Receipts
            <HelpPopout
              title="Receipts"
              sections={[
                {
                  heading: 'What\'s on this page',
                  tips: [
                    { title: 'LLC tiles', description: `One tile per LLC subcategory. Each shows ${year} year-to-date total + receipt count, plus lifetime total in the footer.` },
                    { title: 'At-a-glance grand totals', description: 'Top banner sums every LLC tile so you can see your overall business-receipt spend without drilling in.' },
                    { title: 'Drill in', description: 'Tap any LLC tile to filter the receipts entry list to just that one.' },
                  ],
                },
                {
                  heading: 'Getting receipts in',
                  tips: [
                    { title: 'Snap a single receipt', description: 'Hit the + Add receipt button — opens /receipts/new straight to the camera.' },
                    { title: 'Drop a folder of receipts', description: 'Save files to C:\\Users\\lance\\Documents\\Vault File Drop\\receipts\\<llc-slug>\\. Sync from /import (or wait for the nightly auto-run).' },
                  ],
                },
              ]}
            />
          </h1>
          <p className="text-stone-400 text-sm mt-1">
            Year-to-date and lifetime totals by LLC. Tap a tile to drill in.
          </p>
        </div>
        <Link
          href="/receipts/new"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          <Plus size={14} />
          Add receipt
        </Link>
      </div>

      {/* Grand totals strip */}
      <section className="mb-6 grid grid-cols-3 gap-2 rounded-2xl border border-emerald-800/40 bg-gradient-to-br from-emerald-950/40 to-stone-900/60 p-4">
        <Stat label={`${year} YTD`} value={formatDollars(grandYtd)} accent />
        <Stat label="YTD count" value={String(grandYtdCount)} />
        <Stat label="All-time" value={formatDollars(grandLifetime)} muted />
      </section>

      {/* LLC tile grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.subId}
            href={`/categories/${receiptsCat.slug}?sub=${t.subId}`}
            className="group flex flex-col gap-2 rounded-2xl border border-stone-700/60 bg-stone-900/40 hover:border-emerald-700/60 hover:bg-stone-900/70 p-4 transition"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-stone-100 truncate group-hover:text-emerald-200 transition">
                {t.subName}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-stone-500">{year}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-300">
                {formatDollars(t.ytdCents)}
              </span>
              <span className="text-xs text-stone-500">
                {t.ytdCount} receipt{t.ytdCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500 pt-1 border-t border-stone-800/80">
              <span>Lifetime {formatDollars(t.lifetimeCents)} · {t.lifetimeCount}</span>
              <span>{t.latestDate ? `Last ${t.latestDate}` : 'No receipts yet'}</span>
            </div>
          </Link>
        ))}
      </section>

      {tiles.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-700 p-8 text-center">
          <p className="text-stone-400 text-sm">
            No LLC subcategories found. Run the seed script to create them.
          </p>
        </div>
      )}
      </div>{/* /hidden md:block — desktop wrapper */}
    </div>
  )
}

function Stat({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-stone-500">{label}</span>
      <span
        className={
          accent
            ? 'text-xl font-bold text-emerald-300'
            : muted
              ? 'text-sm font-semibold text-stone-400'
              : 'text-base font-semibold text-stone-200'
        }
      >
        {value}
      </span>
    </div>
  )
}

function formatDollars(cents: number): string {
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
