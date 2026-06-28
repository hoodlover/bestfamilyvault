import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Phone, Globe, ExternalLink } from 'lucide-react'
import { and, asc, eq, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { decryptEntries } from '@/lib/crypto'
import { PrintButton } from '@/components/ui/print-button'
import { EMERGENCY_SHEET_TAG } from '@/lib/emergency-sheet-tag'

export default async function EmergencySheetPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  // Pull every account-shaped entry the user can see. Same visibility model
  // as net worth: isPersonal is owner-only, isPrivate is superuser-only.
  // Logins are filtered down to those tagged EMERGENCY_SHEET_TAG below.
  const allRows = await db
    .select()
    .from(entries)
    .where(
      and(
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(asc(entries.title))

  const decrypted = decryptEntries(allRows)

  const banks = decrypted.filter((e) => e.type === 'bank_account')
  const cards = decrypted.filter((e) => e.type === 'credit_card')
  const recurring = decrypted.filter((e) => e.isRecurring)

  // Build a quick lookup so each recurring row can show "Paid with: <X>"
  // (linked to the source card/account). customFields.paidWith holds
  // either the UUID of the funding entry (credit card, bank, etc.) or
  // the literal string "other"; we resolve the UUID form here so the
  // template stays simple. The lookup pool is `decrypted` (everything
  // visible) so a bank-funded subscription resolves even if the funding
  // entry is a bank_account, not a credit_card.
  const paidWithById = new Map<string, { id: string; title: string }>()
  for (const e of decrypted) paidWithById.set(e.id, { id: e.id, title: e.title })
  const logins = decrypted.filter(
    (e) =>
      e.type === 'login' &&
      Array.isArray(e.tags) &&
      e.tags.includes(EMERGENCY_SHEET_TAG) &&
      // Skip tagged entries that have lost their password — they'd
      // print as a blank row that adds nothing useful for whoever's
      // actually trying to log in from this sheet.
      typeof e.password === 'string' &&
      e.password.trim() !== '',
  )

  return (
    <div className="emergency-sheet p-4 md:p-8 max-w-6xl mx-auto">
      <style>{`
        /* On-screen scroll wrapper — keeps 4-col tables from squishing
           on phones. Each table sits inside a horizontal-scroll box so
           Lance can swipe through long rows instead of seeing them wrap
           into tiny text-knots. Rounded border below dresses it as a
           card; overflow-x:auto keeps the swipe behavior intact. */
        .emergency-sheet .table-wrap {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border: 1px solid rgb(41 37 36 / 0.8);
          border-radius: 0.5rem;
        }
        .emergency-sheet .table-wrap table {
          width: 100%;
          /* Lower than the page's mobile breakpoint so phones still
             scroll-wrap (keeping numbers legible) but desktop / tablet
             always gets the full-width layout, no scrollbar. */
          min-width: 560px;
          border-collapse: collapse;
        }
        /* On-screen row dividers + breathing room. Earlier versions had
           no per-row borders on screen, so adjacent rows ran into each
           other and the page read as one giant text wall. A hairline
           between rows plus extra vertical padding gives each entry a
           visible "card" without adding heavy chrome. Zebra striping on
           even rows reinforces the row boundary at a glance. */
        .emergency-sheet .table-wrap th,
        .emergency-sheet .table-wrap td {
          padding: 0.625rem 0.75rem;
          vertical-align: top;
          text-align: left;
          border-bottom: 1px solid rgb(41 37 36 / 0.7);
        }
        .emergency-sheet .table-wrap th {
          /* Column headers — left-justified per request, soft amber so
             they read as "label" rather than data without screaming. The
             uppercase + tracking gives them a quiet column-header feel. */
          font-weight: 600;
          color: rgb(252 211 77);
          font-size: 0.75rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          background: rgb(28 25 23 / 0.5);
          border-bottom: 1px solid rgb(68 64 60 / 0.8);
        }
        .emergency-sheet .table-wrap tbody tr:nth-child(even) {
          background: rgb(28 25 23 / 0.25);
        }
        .emergency-sheet .table-wrap tbody tr:hover {
          background: rgb(41 37 36 / 0.45);
        }
        .emergency-sheet .table-wrap tbody tr:last-child td {
          border-bottom: none;
        }
        /* Jump-to-card icon next to each row's title. Subtle by default,
           brightens on hover so it doesn't fight the title text for
           attention. The whole title stays plain text (not a link) per
           the request — only the small icon is the affordance. */
        .emergency-sheet .row-jump {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 0.375rem;
          opacity: 0.45;
          color: rgb(168 162 158);
          transition: opacity 120ms, color 120ms;
          vertical-align: middle;
        }
        .emergency-sheet .row-jump:hover {
          opacity: 1;
          color: rgb(110 231 183);
        }

        @media print {
          /* US letter, narrow margins so we fit more rows per page. */
          @page { margin: 0.45in; size: letter; }
          body { background: white !important; font-family: Helvetica, Arial, sans-serif !important; }
          .no-print { display: none !important; }

          .emergency-sheet { color: #000 !important; max-width: none !important; padding: 0 !important; }
          .emergency-sheet h1 { font-size: 18pt !important; margin-bottom: 4pt !important; }
          .emergency-sheet h2 { font-size: 12pt !important; color: #000 !important; border-bottom: 1.5px solid #000 !important; padding-bottom: 2pt !important; margin: 14pt 0 6pt !important; }
          .emergency-sheet p, .emergency-sheet span, .emergency-sheet div, .emergency-sheet td, .emergency-sheet th, .emergency-sheet a { color: #000 !important; }
          .emergency-sheet .sheet-header { border-bottom: 2px solid #000 !important; padding-bottom: 6pt !important; margin-bottom: 12pt !important; }

          /* Drop the forced single-page-per-section rule that was
             chopping output at the first page. Sections are now allowed
             to break across pages; only individual table ROWS stay
             unbroken so a row never gets cut in half. Repeat the
             <thead> on every page via table-header-group so the column
             labels stay visible. */
          .emergency-sheet section { break-inside: auto !important; page-break-inside: auto !important; margin-bottom: 14pt !important; }
          .emergency-sheet .table-wrap { overflow: visible !important; }
          .emergency-sheet table { border-collapse: collapse !important; width: 100% !important; min-width: 0 !important; break-inside: auto !important; page-break-inside: auto !important; }
          .emergency-sheet table thead { display: table-header-group !important; }
          .emergency-sheet table tfoot { display: table-footer-group !important; }
          .emergency-sheet table tr { break-inside: avoid !important; page-break-inside: avoid !important; }

          /* Compact rows for paper density. Word-break stays on long
             URLs / account numbers so a cell doesn't push the column
             beyond the page width. */
          .emergency-sheet table th, .emergency-sheet table td {
            border-bottom: 1px solid #999 !important;
            padding: 4pt 6pt !important;
            font-size: 9.5pt !important;
            line-height: 1.25 !important;
            text-align: left;
            vertical-align: top;
            word-break: break-word;
          }
          .emergency-sheet table th { background: #eee !important; font-weight: bold; font-size: 9pt !important; text-transform: uppercase; letter-spacing: 0.04em; }
          .emergency-sheet .password-cell, .emergency-sheet .mono { font-family: 'Courier New', Courier, monospace !important; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 mb-4">
        <Link
          href="/now-what"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={14} /> back to guide
        </Link>
        <PrintButton label="Print Break Glass…" />
      </div>

      <div className="sheet-header pb-3 mb-6 border-b border-stone-700">
        {/* Title row — hammer icon on the left at the same height as
            the H1 line so the page reads as "Break Glass…" with the
            sledge that smashes it. Icon is hidden in print (no-print)
            since the paper version doesn't need the chrome. */}
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/breakglass.png"
            width={48}
            height={48}
            alt=""
            className="object-contain shrink-0 no-print"
          />
          <h1 className="text-3xl font-bold text-stone-100">Break Glass…</h1>
        </div>
        <p className="text-sm text-stone-400 mt-1">
          Critical accounts, recurring charges, and selected logins for {session.user.name ?? session.user.email}.{' '}
          Generated {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.
        </p>
        <p className="text-xs text-stone-500 mt-2 italic">
          Keep this printout in a safe place — it contains live account numbers and (optionally) passwords.
        </p>
      </div>

      <Section title="Bank accounts" count={banks.length}>
        {banks.length === 0 ? (
          <Empty>No bank accounts in the vault.</Empty>
        ) : (
          <div className="table-wrap">
          {/* Explicit column widths via <colgroup>. Bank account titles
              like "Bluevine Checking 6242 — Next PTC Property" are the
              longest content in this table, so Account gets the lion's
              share. Routing/Acct holds two 9-digit lines (R: + A:) and
              needs ~22% to keep both on single lines. Balance stays slim
              since amounts max out near $XXX,XXX.XX. Contact usually has
              just a phone, occasionally a URL. table-fixed locks the
              ratios in; cell-level whitespace-nowrap keeps routing
              digits and balance totals on a single line. */}
          <table className="table-fixed">
            <colgroup>
              <col style={{ width: '34%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Account</th>
                <th>Routing / Acct</th>
                <th>Balance</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div className="font-medium text-stone-100 break-words">
                      {b.title}
                      <JumpToCard id={b.id} title={b.title} />
                    </div>
                    {b.bankName && <div className="text-xs text-stone-400 break-words">{b.bankName}{b.accountType ? ` · ${b.accountType}` : ''}</div>}
                  </td>
                  <td className="font-mono text-xs">
                    {b.routingNumber && <div className="whitespace-nowrap">R: {b.routingNumber}</div>}
                    {b.accountNumber && <div className="whitespace-nowrap">A: {b.accountNumber}</div>}
                  </td>
                  <td>
                    {b.currentBalance != null ? (
                      <>
                        <div className="font-medium whitespace-nowrap">{formatCents(b.currentBalance)}</div>
                        {b.balanceAsOf && (
                          <div className="text-xs text-stone-500 whitespace-nowrap">as of {formatDate(b.balanceAsOf)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-stone-500 text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <ContactBits phone={b.phone} url={b.url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>

      <Section title="Credit cards" count={cards.length}>
        {cards.length === 0 ? (
          <Empty>No credit cards in the vault.</Empty>
        ) : (
          <div className="table-wrap">
          {/* Re-balanced after Lance trimmed the long contact strings.
              Card shrunk to 28% so the next three columns (Number/Exp,
              Balance, Contact) shift left and visually hug the title
              instead of floating across a sea of empty space. Number
              column at 30% fits the full unmasked card number ("4111
              1111 1111 1111" = 19 chars) on one mono line; Balance at
              14% holds "$307.32" + "as of …" stacked; Contact at 28%
              fits phone + URL each on a single line. */}
          <table className="table-fixed">
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Card</th>
                <th>Number / Exp</th>
                <th>Balance</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="font-medium text-stone-100 break-words">
                      {c.title}
                      <JumpToCard id={c.id} title={c.title} />
                    </div>
                    {c.cardNetwork && <div className="text-xs text-stone-400 break-words">{c.cardNetwork}{c.cardholderName ? ` · ${c.cardholderName}` : ''}</div>}
                  </td>
                  <td className="font-mono text-xs">
                    {/* Full card number — was masked to last 4 only;
                        Lance flagged that as a regression since the
                        whole point of "Break Glass…" is having the
                        actual number on the page when you need it. */}
                    {c.cardNumber && <div className="whitespace-nowrap">{c.cardNumber}</div>}
                    {c.expiryDate && <div className="whitespace-nowrap">exp {c.expiryDate}</div>}
                  </td>
                  <td>
                    {c.currentBalance != null ? (
                      <>
                        <div className="font-medium whitespace-nowrap">{formatCents(c.currentBalance)}</div>
                        {c.balanceAsOf && (
                          <div className="text-xs text-stone-500 whitespace-nowrap">as of {formatDate(c.balanceAsOf)}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-stone-500 text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <ContactBits phone={c.phone} url={c.url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>

      <Section title="Recurring bills" count={recurring.length}>
        {recurring.length === 0 ? (
          <Empty>No recurring entries flagged.</Empty>
        ) : (
          <div className="table-wrap">
          {/* Recurring titles are the worst offenders — auto-imported
              statement lines like "Checkcard 0128 Therapynotes, LLC
              2156584550 PA CKCD 4816 Xxxxxxxxxxxx3796" can run 70+
              chars. Subscription gets ~46% so it usually wraps at most
              once. Amount/Period and Next renewal are short and fixed-
              width, so they stay slim with whitespace-nowrap. Contact
              picks up the rest. */}
          <table className="table-fixed">
            <colgroup>
              <col style={{ width: '46%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Subscription</th>
                <th>Amount / Period</th>
                <th>Next renewal</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => {
                // customFields.paidWith is either a UUID (look it up in
                // paidWithById) or "other" / null. paidWithUrl is the
                // free-text companion for "paid via this website". We
                // render whichever side(s) are populated so the user can
                // jump straight from the Break Glass page to the funding
                // source (the "where do I go to cancel this" answer).
                const cf = r.customFields as { paidWith?: unknown; paidWithUrl?: unknown } | null
                const paidWithRaw = cf?.paidWith
                const paidWithId = typeof paidWithRaw === 'string' && paidWithRaw !== 'other' ? paidWithRaw : null
                const paidWith = paidWithId ? paidWithById.get(paidWithId) ?? null : null
                const paidWithUrl = typeof cf?.paidWithUrl === 'string' && cf.paidWithUrl ? cf.paidWithUrl : null
                return (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium text-stone-100 break-words">
                      {r.title}
                      <JumpToCard id={r.id} title={r.title} />
                    </div>
                    {r.username && <div className="text-xs text-stone-400 break-words">{r.username}</div>}
                    {(paidWith || paidWithUrl) && (
                      <div className="text-xs text-emerald-300/80 break-words mt-0.5">
                        Paid with:{' '}
                        {paidWith && (
                          <Link href={`/entries/${paidWith.id}`} className="underline decoration-emerald-700/60 hover:decoration-emerald-400">
                            {paidWith.title}
                          </Link>
                        )}
                        {paidWith && paidWithUrl && <span className="text-stone-500"> · </span>}
                        {paidWithUrl && (
                          <a
                            href={paidWithUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline decoration-emerald-700/60 hover:decoration-emerald-400 break-all"
                          >
                            {paidWithUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.subscriptionAmountCents != null ? (
                      <div className="font-medium whitespace-nowrap">{formatCents(r.subscriptionAmountCents)}{r.subscriptionPeriod ? ` / ${r.subscriptionPeriod}` : ''}</div>
                    ) : (
                      <span className="text-stone-500 text-xs">—</span>
                    )}
                  </td>
                  <td>
                    {r.subscriptionRenewsAt ? (
                      <span className="text-xs whitespace-nowrap">{r.subscriptionRenewsAt}</span>
                    ) : (
                      <span className="text-stone-500 text-xs">—</span>
                    )}
                  </td>
                  <td>
                    <ContactBits phone={r.phone} url={r.url} />
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </Section>

      <Section title="Critical logins" count={logins.length}>
        {logins.length === 0 ? (
          <Empty>
            No logins tagged for this sheet yet. Visit{' '}
            <Link href="/admin/emergency-sheet" className="text-emerald-400 underline">
              /admin/emergency-sheet
            </Link>{' '}
            to pick which logins to include.
          </Empty>
        ) : (
          <div className="table-wrap">
          {/* Logins: Account titles like "Anthem Blue Cross Blue Shield
              Insurance 2026" run ~40 chars; URLs (axosbank Login flow,
              Chase logon path) can run 60+. Both need real estate. We
              split 24/18/18/40 so neither wraps more than once on a
              normal screen. break-words on Account so long account
              names break cleanly; break-all on URL/Username/Password so
              they wrap mid-string instead of busting the column. */}
          <table className="table-fixed">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '40%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Account</th>
                <th>Username</th>
                <th>Password</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {logins.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="font-medium text-stone-100 break-words">
                      {l.title}
                      <JumpToCard id={l.id} title={l.title} />
                    </div>
                  </td>
                  <td className="font-mono text-xs break-all">{l.username ?? '—'}</td>
                  <td className="password-cell font-mono text-xs break-all">{l.password ?? '—'}</td>
                  <td className="text-xs break-all">{l.url ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-2 text-base font-bold text-emerald-300 uppercase tracking-wider mb-3 border-b border-stone-800 pb-1.5">
        <span>{title}</span>
        <span className="inline-flex items-center justify-center rounded-full bg-emerald-950/40 text-emerald-200/70 text-[10px] font-medium px-2 py-0.5 normal-case tracking-normal">
          {count}
        </span>
      </h2>
      {children}
    </section>
  )
}

// Small jump-to-card icon rendered next to each row's title. Keeps the
// title itself plain text — only the icon is clickable, per request.
// Hidden on print (no-print) so the paper version isn't littered with
// icons that mean nothing offline. aria-label gives screen readers and
// hover-tooltips a useful "open <title>" affordance.
function JumpToCard({ id, title }: { id: string; title: string }) {
  return (
    <Link
      href={`/entries/${id}`}
      aria-label={`Open ${title}`}
      title={`Open ${title}`}
      className="row-jump no-print"
    >
      <ExternalLink size={12} />
    </Link>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-stone-400 italic">{children}</p>
}

function ContactBits({ phone, url }: { phone: string | null; url: string | null }) {
  if (!phone && !url) return <span className="text-stone-500 text-xs">—</span>
  return (
    <div className="text-xs space-y-0.5">
      {phone && (
        <div className="flex items-center gap-1">
          <Phone size={10} className="shrink-0" />
          <span>{phone}</span>
        </div>
      )}
      {url && (
        <div className="flex items-center gap-1">
          <Globe size={10} className="shrink-0" />
          <span className="break-all">{url}</span>
        </div>
      )}
    </div>
  )
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

