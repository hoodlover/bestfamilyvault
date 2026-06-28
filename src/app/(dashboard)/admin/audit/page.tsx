// Stale-entry auditor. Surfaces credit cards that have expired or are
// about to, plus login entries that look abandoned (no recent updates,
// missing useful fields). The user reviews each one and either edits,
// deletes, or leaves it. Read-only for the page itself — actual changes
// happen via the existing edit/delete actions.
//
// Superuser/admin only — this is destructive territory.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, AlertTriangle, Clock, FileX, ShieldAlert } from 'lucide-react'
import { decryptEntries } from '@/lib/crypto'
import { HelpPopout } from '@/components/ui/help-popout'
import { formatEntryType } from '@/lib/format'
import { AuditRowActions } from '@/components/ui/audit-row-actions'

const STALE_LOGIN_YEARS = 2
const EXPIRING_SOON_DAYS = 60

export default async function AuditPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') redirect('/dashboard')

  const isSuperuser = session.user.role === 'superuser'
  const userId = session.user.id

  // Pull every entry the caller can access, then bucket client-side. The
  // dataset is tiny (a family vault), so a full table scan is fine and
  // simpler than building four separate filtered queries.
  const rawRows = await db
    .select()
    .from(entries)
    .where(
      and(
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        // isPersonal is owner-only — superuser does NOT bypass.
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )

  const decrypted = decryptEntries(rawRows)

  // Resolve category labels in one shot.
  const cats = await db.select({ id: categories.id, name: categories.name }).from(categories)
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  const now = new Date()
  const soonCutoff = new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000)
  const staleCutoff = new Date(now)
  staleCutoff.setFullYear(staleCutoff.getFullYear() - STALE_LOGIN_YEARS)

  type Row = (typeof decrypted)[number]
  const expired: Row[] = []
  const expiringSoon: Row[] = []
  const staleLogins: Row[] = []
  const bareEntries: Row[] = []
  const incompleteLogins: Row[] = []

  for (const r of decrypted) {
    if ((r.type === 'credit_card' || r.type === 'bank_account') && r.expiryDate) {
      const exp = parseExpiry(r.expiryDate)
      if (exp) {
        if (exp.getTime() < now.getTime()) expired.push(r)
        else if (exp.getTime() < soonCutoff.getTime()) expiringSoon.push(r)
      }
    }

    if (r.type === 'login') {
      const hasUsername = !!r.username?.trim()
      const hasPassword = !!r.password?.trim()
      const hasUrl = !!r.url?.trim()
      const hasNote = !!r.noteContent?.trim()
      const isBare = !hasUsername && !hasPassword && !hasUrl && !hasNote
      if (isBare) {
        bareEntries.push(r)
      } else {
        // Missing username OR password (or both) but has some other
        // content — partially-filled drafts. Distinct from bare.
        if (!hasUsername || !hasPassword) incompleteLogins.push(r)
        if (r.updatedAt && r.updatedAt.getTime() < staleCutoff.getTime()) {
          staleLogins.push(r)
        }
      }
    }
  }

  // Sort each bucket so the most actionable items float to the top.
  expired.sort((a, b) => parseExpiry(a.expiryDate ?? '')!.getTime() - parseExpiry(b.expiryDate ?? '')!.getTime())
  expiringSoon.sort((a, b) => parseExpiry(a.expiryDate ?? '')!.getTime() - parseExpiry(b.expiryDate ?? '')!.getTime())
  staleLogins.sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0))
  bareEntries.sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0))
  incompleteLogins.sort((a, b) => (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0))

  const total = expired.length + expiringSoon.length + staleLogins.length + bareEntries.length + incompleteLogins.length

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Audit</span>
      </nav>

      <h1 className="flex items-center gap-2 text-2xl font-bold text-stone-100 mb-1">
        <ShieldAlert size={22} className="text-amber-400" />
        Stale Entry Audit
        <HelpPopout
          title="Stale Entry Audit"
          sections={[
            {
              heading: 'What gets flagged',
              tips: [
                { title: 'Expired cards', description: 'Credit cards / IDs / documents whose expiration date has passed.' },
                { title: 'Stale logins', description: `Logins not touched in ${STALE_LOGIN_YEARS}+ years. Threshold is in src/app/(dashboard)/admin/audit/page.tsx.` },
                { title: 'Empty rows', description: 'Entries with no meaningful content — usually leftover from a half-finished import.' },
              ],
            },
            {
              heading: 'What to do',
              tips: [
                { title: 'Edit / Delete / Skip', description: 'Per-row buttons. "Skip" leaves it alone but won\'t flag again unless re-triggered.' },
                { title: 'Bulk select', description: 'Tick multiple, then bulk-delete or bulk-mark-resolved.' },
              ],
            },
          ]}
        />
      </h1>
      <p className="text-sm text-stone-400 mb-6">
        Cards that have expired, logins that haven&rsquo;t been touched in {STALE_LOGIN_YEARS}+ years, and
        entries with nothing useful in them. Review each and decide: edit, delete, or leave it.
      </p>

      {total === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">Nothing to clean up. Vault looks tidy.</p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section
            title="Expired cards"
            description="Expiry date is in the past. Probably gift cards / store-value cards / cards already replaced."
            icon={<AlertTriangle size={18} className="text-red-400" />}
            tone="red"
            items={expired}
            extra={(r) => `Expired ${r.expiryDate}`}
            catName={catName}
          />

          <Section
            title="Expiring soon"
            description={`Within ${EXPIRING_SOON_DAYS} days. Heads-up for the cards that will renew or break subscriptions.`}
            icon={<Clock size={18} className="text-amber-400" />}
            tone="amber"
            items={expiringSoon}
            extra={(r) => `Expires ${r.expiryDate}`}
            catName={catName}
          />

          <Section
            title={`Stale logins (${STALE_LOGIN_YEARS}+ years)`}
            description="Login entries that haven't been updated in a long time. Probably dead accounts."
            icon={<Clock size={18} className="text-stone-500" />}
            tone="stone"
            items={staleLogins}
            extra={(r) => `Last touched ${r.updatedAt?.toLocaleDateString() ?? '—'}`}
            catName={catName}
          />

          <Section
            title="Incomplete logins"
            description="Login entries missing a username or a password (one or the other). Has some other content but isn't fully usable for autofill. Review and delete the ones that aren't worth completing."
            icon={<FileX size={18} className="text-amber-400" />}
            tone="amber"
            items={incompleteLogins}
            extra={(r) => {
              const missing: string[] = []
              if (!r.username?.trim()) missing.push('username')
              if (!r.password?.trim()) missing.push('password')
              return `Missing: ${missing.join(' + ')}`
            }}
            catName={catName}
          />

          <Section
            title="Bare entries"
            description="Login entries with no username, password, URL, or notes. Probably abandoned drafts."
            icon={<FileX size={18} className="text-stone-500" />}
            tone="stone"
            items={bareEntries}
            extra={(r) => `Created ${r.createdAt?.toLocaleDateString() ?? '—'}`}
            catName={catName}
          />
        </div>
      )}
    </div>
  )
}

interface AuditEntry {
  id: string
  title: string
  type: string
  categoryId: string
  expiryDate?: string | null
  updatedAt?: Date | null
  createdAt?: Date | null
  username?: string | null
  password?: string | null
}

interface SectionProps {
  title: string
  description: string
  icon: React.ReactNode
  tone: 'red' | 'amber' | 'stone'
  items: AuditEntry[]
  extra: (r: AuditEntry) => string
  catName: Map<string, string>
}

function Section({ title, description, icon, tone, items, extra, catName }: SectionProps) {
  if (items.length === 0) return null
  const toneClass =
    tone === 'red'
      ? 'border-red-800/40 bg-red-950/10'
      : tone === 'amber'
        ? 'border-amber-800/40 bg-amber-950/10'
        : 'border-stone-700/50 bg-stone-800/20'

  return (
    <section className={`rounded-2xl border ${toneClass} p-4 md:p-5`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-sm font-semibold text-stone-100">
          {title}
          <span className="ml-2 text-stone-500 font-normal">({items.length})</span>
        </h2>
      </div>
      <p className="text-xs text-stone-400 mb-3 ml-6">{description}</p>

      <div className="divide-y divide-stone-800/70">
        {items.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/entries/${r.id}`} className="text-sm font-medium text-stone-200 hover:text-emerald-300 transition truncate block">
                {r.title}
              </Link>
              <div className="mt-0.5 text-[11px] text-stone-500 truncate">
                {formatEntryType(r.type)}
                {' · '}
                {catName.get(r.categoryId) ?? '—'}
                {' · '}
                {extra(r)}
              </div>
            </div>
            <AuditRowActions id={r.id} />
          </div>
        ))}
      </div>
    </section>
  )
}

// Parses "MM/YY" or "MM/YYYY" into a Date at end-of-month. Returns null if
// the value doesn't match — treat unparseable dates as "no signal" rather
// than flagging them as expired.
function parseExpiry(raw: string): Date | null {
  if (!raw) return null
  const m = raw.match(/^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/)
  if (!m) return null
  const month = parseInt(m[1], 10)
  if (month < 1 || month > 12) return null
  let year = parseInt(m[2], 10)
  if (m[2].length === 2) year += 2000
  // Last day of the expiry month — cards are valid through end-of-month.
  return new Date(year, month, 0, 23, 59, 59)
}
