import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, categories, files, entryFavorites } from '@/lib/db/schema'
import { and, eq, desc, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, Star, Pencil, Paperclip } from 'lucide-react'
import { DeleteEntryButton } from '@/components/ui/delete-entry-button'
import { EntryBackButton } from '@/components/ui/entry-back-button'
import { RecurringToggleButton } from '@/components/ui/recurring-toggle-button'
import { FileList } from '@/components/ui/file-list'
import { FileUpload } from '@/components/ui/file-upload'
import { AssetThumbnailPicker } from '@/components/ui/asset-thumbnail-picker'
import { isVehicularKind, parseMileageHistory } from '@/lib/vehicular'
import { entryTypeHasPhone } from '@/lib/entry-fields'
import { PlaidConnect } from '@/components/ui/plaid-connect'
import { SecretField } from '@/components/ui/secret-field'
import { LinkedCredentials } from '@/components/ui/linked-credentials'
import { LinkifiedText } from '@/components/ui/linkified-text'
import { decryptEntries, decryptEntryFields } from '@/lib/crypto'
import { formatEntryType } from '@/lib/format'

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const isSuperuser = session?.user?.role === 'superuser'
  const isReadonly = session?.user?.role === 'readonly'

  const rawEntry = await db
    .select()
    .from(entries)
    .where(eq(entries.id, id))
    .then((r) => r[0])

  if (!rawEntry) notFound()
  if (rawEntry.isPrivate && !isSuperuser) redirect('/dashboard')
  // isPersonal is strictly owner-only (superuser does not bypass).
  if (rawEntry.isPersonal && rawEntry.createdBy !== session?.user?.id) {
    redirect('/dashboard')
  }

  // If this entry is a child of a merged group, redirect to the master so the
  // user always sees the full picture (master + all linked credentials).
  //
  // BUT: a pre-v281 bug let the mergeEntries promote path produce a
  // two-row cycle where each entry pointed at the other as parent. If
  // *this* entry already has its own children (i.e. something else
  // points at it as parent), it IS the master regardless of what its
  // parentEntryId column says — clear that column in place and render
  // normally instead of redirecting. Self-heals existing cycles the
  // moment Lance opens the page.
  if (rawEntry.parentEntryId) {
    const ownChildren = await db
      .select({ id: entries.id })
      .from(entries)
      .where(eq(entries.parentEntryId, rawEntry.id))
      .limit(1)
    if (ownChildren.length > 0) {
      await db
        .update(entries)
        .set({ parentEntryId: null, updatedAt: new Date() })
        .where(eq(entries.id, rawEntry.id))
      rawEntry.parentEntryId = null
    } else {
      redirect(`/entries/${rawEntry.parentEntryId}`)
    }
  }

  const entry = decryptEntryFields(rawEntry)

  // Resolve the "Paid with" link if the entry has one — points at a
  // credit-card entry that should still be visible to this user.
  const paidWithValue = (entry.customFields?.paidWith as string | undefined) ?? null
  const paidWithIsId = !!paidWithValue && paidWithValue !== 'other'
  // Free-text URL companion — rendered next to the dropdown value so a
  // subscription can show "Visa 7030 via paypal.com" if both are set.
  const paidWithUrl = (entry.customFields?.paidWithUrl as string | undefined) ?? null

  // Self-heal: pre-v293 merges left children's attached files stranded.
  // v289 walked one level (direct children) which covered single-shot
  // merges; v293 widens to the FULL descendant tree because Lance
  // reported a 4-login merged group where 6 of 11 files stayed missing.
  // Cause: multi-stage merges produce grandchildren (master A → child B
  // → grandchild D when A+B is merged later with a C+D group that was
  // merged earlier), and the v289 one-level scan missed those.
  //
  // BFS from `entry.id` collecting every descendant. Then a single
  // UPDATE moves every file off any descendant onto the master, plus a
  // second UPDATE flattens the chain (every descendant becomes a direct
  // child of the master) so we never need to BFS again on subsequent
  // views. Idempotent — empty descendant set → no UPDATEs.
  const allDescendantIds: string[] = []
  {
    let frontier: string[] = [entry.id]
    while (frontier.length > 0) {
      const next = await db
        .select({ id: entries.id })
        .from(entries)
        .where(inArray(entries.parentEntryId, frontier))
      if (next.length === 0) break
      const ids = next.map((c) => c.id)
      allDescendantIds.push(...ids)
      frontier = ids
    }
  }
  if (allDescendantIds.length > 0) {
    await db
      .update(files)
      .set({ entryId: entry.id })
      .where(inArray(files.entryId, allDescendantIds))
    // Flatten: every descendant becomes a direct child so future BFS
    // loops terminate after one step.
    await db
      .update(entries)
      .set({ parentEntryId: entry.id })
      .where(inArray(entries.id, allDescendantIds))
  }

  const [category, attachedFiles, childEntries, paidWithEntry] = await Promise.all([
    db.select().from(categories).where(eq(categories.id, entry.categoryId)).then((r) => r[0]),
    db.select().from(files).where(eq(files.entryId, entry.id)),
    db.select().from(entries).where(eq(entries.parentEntryId, entry.id)).orderBy(desc(entries.updatedAt)).then((r) => decryptEntries(r)),
    paidWithIsId
      ? db
          .select({ id: entries.id, title: entries.title, cardNetwork: entries.cardNetwork, isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
          .from(entries)
          .where(eq(entries.id, paidWithValue))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ])

  const canSeePaidWithCard = paidWithEntry &&
    (!paidWithEntry.isPrivate || isSuperuser) &&
    (!paidWithEntry.isPersonal || paidWithEntry.createdBy === session?.user?.id)

  // Per-user star — favorites are stored in entry_favorite, not the legacy
  // entries.is_favorite column.
  const userFavorited = session?.user?.id
    ? await db
        .select({ id: entryFavorites.id })
        .from(entryFavorites)
        .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, id)))
        .then((r) => r.length > 0)
    : false

  const canEdit = !isReadonly
  const hasGroup = childEntries.length > 0

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Prominent back button — replaces the easy-to-miss faint
          breadcrumb as the primary "get me out of here" affordance.
          Lands wherever the user came from (search w/ query, category,
          dashboard) thanks to router.back(). */}
      <EntryBackButton />

      {/* Breadcrumb — trails off at the category. The entry title is
          already rendered as the H1 immediately below, so repeating it
          here was redundant + ate horizontal space on mobile. */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/dashboard" className="hover:text-stone-300 transition">Dashboard</Link>
        {category && (
          <>
            <ChevronRight size={14} />
            <Link href={`/categories/${category.slug}`} className="hover:text-stone-300 transition">{category.name}</Link>
          </>
        )}
      </nav>

      {/* Header — title gets its own row so it can wrap freely; the meta
          row beneath pairs the chips (count / private / favorite) on the
          left with the action icons (recurring / edit / delete) on the
          right. Lance asked for the count chip + action icons to share a
          line so the open-card view doesn't waste a row stacking them. */}
      <div className="mb-6 md:mb-8 space-y-3">
        <h1 className="text-xl md:text-2xl font-bold text-stone-100 leading-tight break-words">{entry.title}</h1>
        {(attachedFiles.length > 0 || entry.isPrivate || userFavorited || canEdit) && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {userFavorited && <Star size={18} className="text-emerald-400 fill-emerald-400 shrink-0" />}
              {entry.isPrivate && (
                <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 px-2 py-0.5 rounded-full">
                  <img src="/icons/cobb/privatevault.png" width={10} height={10} alt="" className="object-contain opacity-80" /> Private
                </span>
              )}
              {/* Attachment count chip — same visual as the one on browse
                  cards so the indicator reads identically when the user
                  drills in. */}
              {attachedFiles.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded-full px-2 py-0.5"
                  title={`${attachedFiles.length} attachment${attachedFiles.length === 1 ? '' : 's'}`}
                >
                  <Paperclip size={11} />
                  {attachedFiles.length}
                </span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 flex-nowrap shrink-0">
                <RecurringToggleButton entryId={entry.id} initialRecurring={entry.isRecurring} />
                <Link
                  href={`/entries/${entry.id}/edit`}
                  aria-label="Edit"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 hover:text-stone-100 text-sm rounded-lg transition"
                >
                  <Pencil size={13} />
                  <span className="hidden md:inline">Edit</span>
                </Link>
                <DeleteEntryButton id={entry.id} categorySlug={category?.slug} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="bg-stone-800/60 border border-stone-700/50 rounded-2xl p-6 space-y-4">
        {/* Asset entries get a 2-column hero — thumbnail on the left,
            Type row on the right at the same vertical level, then the
            AssetValueBlock flowing beneath the Type row. The thumbnail
            spans both. Non-asset entries just render Type top to bottom
            normally below. */}
        {entry.type === 'asset' ? (
          <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
            <AssetThumbnailPicker
              entryId={entry.id}
              currentThumbnailFileId={entry.customFields?.thumbnailFileId ?? null}
              currentCrop={{
                offsetX: numOr(entry.customFields?.thumbnailOffsetX, 50),
                offsetY: numOr(entry.customFields?.thumbnailOffsetY, 50),
                scale: numOr(entry.customFields?.thumbnailScale, 1),
              }}
              imageAttachments={attachedFiles
                .filter((f) => f.contentType.startsWith('image/'))
                .map((f) => ({ id: f.id, filename: f.filename }))}
              canEdit={canEdit}
            />
            <div className="flex-1 min-w-0 space-y-4">
              {/* Type + Asset Kind share a row — they're both short labels
                  and stacking them ate vertical space. AssetValueBlock no
                  longer renders its own Asset Kind row when this pair is
                  in play (assetKindInHero prop). */}
              <div className="grid grid-cols-2 gap-3">
                <EntryField label="Type" value={formatEntryType(entry.type)} />
                {entry.accountType && (
                  <EntryField label="Asset Kind" value={entry.accountType} />
                )}
              </div>
              <AssetValueBlock
                currentBalanceCents={entry.currentBalance}
                balanceAsOf={entry.balanceAsOf}
                accountType={entry.accountType}
                purchaseValueCents={entry.customFields?.purchaseValueCents ?? null}
                purchaseDate={entry.customFields?.purchaseDate ?? null}
                assetKindInHero
              />
              {isVehicularKind(entry.accountType) && (
                <MileageHistoryPanel raw={entry.customFields?.mileageHistory ?? null} />
              )}
            </div>
          </div>
        ) : entry.type === 'bank_account' ? (
          // Bank Account merges Type + Account Type into one row reading
          // "Bank Account · Checking" — they're conceptually paired and
          // stacking them ate vertical space without adding clarity.
          <EntryField
            label="Type"
            value={`${formatEntryType(entry.type)}${entry.accountType ? ` · ${entry.accountType}` : ''}`}
          />
        ) : entry.type === 'credit_card' ? (
          // Same trick for credit cards: "Credit Card · Visa".
          <EntryField
            label="Type"
            value={`${formatEntryType(entry.type)}${entry.cardNetwork ? ` · ${entry.cardNetwork}` : ''}`}
          />
        ) : (
          <EntryField label="Type" value={formatEntryType(entry.type)} />
        )}

        {/* Login + app_login — app_login is structurally identical (same
            fields, just tagged so /apps can list it on its own). When this
            entry has linked credentials, the username/password for the
            master are shown inside the LinkedCredentials panel below.
            Username + Password share a row on md+ since they're paired
            credentials. Phone moved out to its own row above the Notes
            block, see below. */}
        {(entry.type === 'login' || entry.type === 'app_login') && (
          <>
            {!hasGroup && (
              <Pair>
                {entry.username && <EntryField label="Username" value={entry.username} copyable />}
                {entry.password && <EntryField label="Password" value={entry.password} copyable secret />}
              </Pair>
            )}
            {entry.url && <EntryField label="URL" value={entry.url} isUrl />}
          </>
        )}

        {/* Bank Account — Account # | Routing #, Username | Password each
            share a row on md+ (single col on mobile). Bank stands alone
            since Phone is rendered above Notes (Lance preference). URL
            full-width since URLs can be long. Type + Account Type are
            merged into the Type row above. */}
        {entry.type === 'bank_account' && (
          <>
            {entry.bankName && <EntryField label="Bank" value={entry.bankName} />}
            <Pair tight>
              {entry.accountNumber && <EntryField label="Account #" value={entry.accountNumber} copyable secret />}
              {entry.routingNumber && <EntryField label="Routing #" value={entry.routingNumber} copyable secret />}
            </Pair>
            <Pair>
              {entry.username && <EntryField label="Username" value={entry.username} copyable />}
              {entry.password && <EntryField label="Password" value={entry.password} copyable secret />}
            </Pair>
            {entry.url && <EntryField label="URL" value={entry.url} isUrl />}
          </>
        )}

        {/* Credit Card — Card # full-width (16 digits when revealed),
            Expires | CVV paired. Cardholder stands alone since Phone is
            rendered above Notes (Lance preference). Type + Network are
            merged into the Type row above. */}
        {entry.type === 'credit_card' && (
          <>
            {entry.cardholderName && <EntryField label="Cardholder" value={entry.cardholderName} />}
            {entry.cardNumber && <EntryField label="Card #" value={entry.cardNumber} copyable secret />}
            <Pair>
              {entry.expiryDate && <EntryField label="Expires" value={entry.expiryDate} />}
              {entry.cvv && <EntryField label="CVV" value={entry.cvv} copyable secret />}
            </Pair>
          </>
        )}

        {/* Identity — pair First | Last, SSN | Passport. DOB and DL
            full-width. Phone lives above Notes (Lance preference). */}
        {entry.type === 'identity' && (
          <>
            <Pair>
              {entry.firstName && <EntryField label="First Name" value={entry.firstName} />}
              {entry.lastName && <EntryField label="Last Name" value={entry.lastName} />}
            </Pair>
            {entry.dateOfBirth && <EntryField label="Date of Birth" value={entry.dateOfBirth} />}
            <Pair>
              {entry.ssn && <EntryField label="SSN" value={entry.ssn} copyable secret />}
              {entry.passport && <EntryField label="Passport" value={entry.passport} copyable secret />}
            </Pair>
            {entry.driversLicense && <EntryField label="Driver&rsquo;s License" value={entry.driversLicense} copyable />}
          </>
        )}

        {/* Paid with — surfaced only when set. Card entries get a clickable
            link; "other" or a stale id falls back to plain text. The free-
            text URL companion (paidWithUrl) renders on its own line just
            below so "paid via paypal.com" still shows up even when no
            card is picked. */}
        {(paidWithValue || paidWithUrl) && (
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Paid with</label>
            <div className="mt-1 text-sm space-y-1">
              {paidWithIsId && canSeePaidWithCard && paidWithEntry ? (
                <div>
                  <Link href={`/entries/${paidWithEntry.id}`} className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2">
                    {paidWithEntry.title}
                    {paidWithEntry.cardNetwork ? ` (${paidWithEntry.cardNetwork})` : ''}
                  </Link>
                </div>
              ) : paidWithIsId ? (
                <div className="text-stone-500 italic">Linked card no longer visible</div>
              ) : paidWithValue ? (
                <div className="text-stone-300">Other (cash / debit / not on file)</div>
              ) : null}
              {paidWithUrl && (
                <div>
                  <a
                    href={paidWithUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-300 hover:text-emerald-200 underline underline-offset-2 break-all"
                  >
                    {paidWithUrl}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phone — parked right above the Notes block so contact info
            reads as a preamble to the freeform notes. Lance preference
            over pairing Phone with the first type-specific field; this
            placement reads cleaner across bank / card / login / ID
            entries. entryTypeHasPhone keeps it suppressed for assets,
            which can leave a leftover phone in the DB but shouldn't
            surface one. */}
        {entry.phone && entryTypeHasPhone(entry.type) && (
          <EntryField label="Phone" value={entry.phone} copyable />
        )}

        {/* Notes on entry — shown here only when this is a standalone entry. For
            grouped entries, the master's notes are surfaced inside LinkedCredentials. */}
        {!hasGroup && entry.noteContent && (
          <div>
            <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Notes</label>
            <p className="mt-1.5 text-stone-300 text-sm whitespace-pre-wrap break-words">
              <LinkifiedText text={entry.noteContent} />
            </p>
          </div>
        )}
      </div>

      {/* Linked credentials (merged group) */}
      {hasGroup && entry.type === 'login' && (
        <div className="mt-6">
          <LinkedCredentials parent={entry} childEntries={childEntries} canEdit={canEdit} />
        </div>
      )}

      {/* Plaid — bank + credit-card only. Read-only users see the
          linked-status badge but can't initiate a link or trigger a
          sync (the API routes reject readonly callers anyway). */}
      {(entry.type === 'bank_account' || entry.type === 'credit_card') && canEdit && (
        <div className="mt-6">
          <PlaidConnect
            entryId={entry.id}
            linkedItemId={entry.plaidItemId}
            linkedAccountId={entry.plaidAccountId}
            syncedAt={entry.plaidSyncedAt ? entry.plaidSyncedAt.toISOString() : null}
          />
        </div>
      )}

      {/* Files */}
      {(attachedFiles.length > 0 || canEdit) && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">Attachments</h2>
          {attachedFiles.length > 0 && (
            <div className="mb-3">
              <FileList files={attachedFiles} canDelete={canEdit} />
            </div>
          )}
          {canEdit && (
            <FileUpload entryId={entry.id} isPrivate={entry.isPrivate} />
          )}
        </div>
      )}

      {/* Footer meta */}
      <div className="mt-6 text-xs text-stone-600">
        Created {entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : ''} ·
        Last updated {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''}
      </div>
    </div>
  )
}

// Parse a string customField value (everything in customFields is
// serialised as text) into a number, falling back to a default when
// the field is missing or non-numeric. Used to read thumbnail crop
// params back into the picker's typed Crop shape.
function numOr(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

// Read-only display for the vehicle mileage log. Renders newest-first
// with miles delta from the prior reading so Lance can eyeball annual
// drive volume without opening the edit form. Empty list hides the
// panel entirely.
//
// Mobile sizing: short date format (M/D/YY ≈ 7 chars) in a narrow w-14
// column so the miles + delta have room to sit on the same line without
// wrapping. Desktop relaxes back to full month-day-year format.
function MileageHistoryPanel({ raw }: { raw: string | null }) {
  const readings = parseMileageHistory(raw)
  if (readings.length === 0) return null
  const sorted = [...readings].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
  const fmtDateShort = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return iso
    const y2 = m[1].slice(2)
    return `${Number(m[2])}/${Number(m[3])}/${y2}`
  }
  const fmtDateLong = (iso: string) => {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return iso
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
      .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return (
    <div className="rounded-xl border border-stone-700/50 bg-stone-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400 font-semibold">Mileage log</p>
        <p className="text-[11px] text-stone-500">{readings.length} reading{readings.length === 1 ? '' : 's'}</p>
      </div>
      <ul className="space-y-1">
        {sorted.map((r, i) => {
          const prior = sorted[i + 1]
          const delta = prior ? r.miles - prior.miles : null
          return (
            <li key={`${r.date}-${r.miles}`} className="flex items-center gap-2 md:gap-3 text-sm">
              <span className="text-stone-400 tabular-nums shrink-0 w-14 md:w-28">
                <span className="md:hidden">{fmtDateShort(r.date)}</span>
                <span className="hidden md:inline">{fmtDateLong(r.date)}</span>
              </span>
              <span className="text-stone-100 tabular-nums font-medium">{r.miles.toLocaleString()} mi</span>
              {delta != null && delta >= 0 && (
                <span className="text-[11px] text-emerald-400 tabular-nums ml-auto md:ml-0">
                  +{delta.toLocaleString()}
                  <span className="hidden md:inline"> since prior</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// AssetValueBlock — the prominent "what's it worth today?" block on
// asset entries. Reuses the rest of the form's EntryField wrapper for
// the small basis rows so the layout stays visually consistent.
function AssetValueBlock({
  currentBalanceCents,
  balanceAsOf,
  accountType,
  purchaseValueCents,
  purchaseDate,
  assetKindInHero,
}: {
  currentBalanceCents: number | null
  balanceAsOf: Date | null
  accountType: string | null
  purchaseValueCents: string | null
  purchaseDate: string | null
  /** When true the parent has already rendered Asset Kind alongside Type
   *  in a 2-col grid, so suppress our own Asset Kind row to avoid the
   *  duplicate. Default false keeps non-hero asset views unchanged. */
  assetKindInHero?: boolean
}) {
  const fmt = (cents: number) =>
    (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const asOf = balanceAsOf
    ? new Date(balanceAsOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const purchaseDollars =
    purchaseValueCents && Number.isFinite(Number(purchaseValueCents))
      ? fmt(Number(purchaseValueCents))
      : null

  return (
    <>
      {accountType && !assetKindInHero && <EntryField label="Asset Kind" value={accountType} />}
      <div className="rounded-xl border border-emerald-700/30 bg-gradient-to-br from-emerald-950/40 via-stone-900/40 to-stone-900/40 p-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Today&rsquo;s value</p>
        <p
          className="text-3xl font-bold text-stone-100 mt-1 leading-tight"
          style={{ textShadow: '0 0 18px rgba(16,185,129,0.55), 0 0 4px rgba(16,185,129,0.4)' }}
        >
          {currentBalanceCents != null ? fmt(currentBalanceCents) : '—'}
        </p>
        {asOf && <p className="text-xs text-stone-400 mt-1">as of {asOf}</p>}
      </div>
      {(purchaseDollars || purchaseDate) && (
        <div className="grid grid-cols-2 gap-4">
          {purchaseDollars && <EntryField label="Purchase Value" value={purchaseDollars} />}
          {purchaseDate && <EntryField label="Purchase Date" value={purchaseDate} />}
        </div>
      )}
    </>
  )
}

// Layout helper — pairs two short EntryFields side-by-side. By default
// stacks on mobile (single column) and pairs on md+. Pass `tight` to
// force 2-col on every breakpoint — use it when both values are short
// (account/routing numbers default-displayed as ••••) and cramming
// them side-by-side on a phone is fine. Filters out null/false/empty
// children so callers can drop in `{cond && <EntryField .../>}` for
// each slot without worrying about empty cells. When only one child
// survives, it renders alone full-width (no awkward half-row).
function Pair({ children, tight }: { children: React.ReactNode; tight?: boolean }) {
  const items = (Array.isArray(children) ? children : [children]).filter(
    (c): c is React.ReactNode => c !== null && c !== false && c !== '' && c !== undefined,
  )
  if (items.length === 0) return null
  if (items.length === 1) return <>{items[0]}</>
  const cols = tight ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'
  return <div className={`grid ${cols} gap-3 md:gap-4`}>{children}</div>
}

function EntryField({
  label,
  value,
  copyable,
  secret,
  isUrl,
}: {
  label: string
  value: string
  copyable?: boolean
  secret?: boolean
  isUrl?: boolean
}) {
  // SecretField owns the whole two-row block (label + icons on top,
  // value below) so the reveal / copy buttons can stay aligned with
  // the label instead of drifting horizontally when the value toggles
  // between '••••' and the real digits.
  if (secret || copyable) {
    return <SecretField label={label} value={value} secret={!!secret} copyable={!!copyable} />
  }
  return (
    <div>
      <label className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{label}</label>
      <div className="mt-1.5">
        {isUrl ? (
          (() => {
            const display = value.replace(/^https?:\/\//, '').replace(/^www\./, '')
            const short = display.length > 48 ? display.slice(0, 47) + '…' : display
            return (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                title={value}
                className="text-emerald-400 hover:text-emerald-300 text-sm break-all transition underline decoration-emerald-700 hover:decoration-emerald-500 underline-offset-2"
              >
                {short}
              </a>
            )
          })()
        ) : (
          <span className="text-stone-300 text-sm font-mono break-all">{value}</span>
        )}
      </div>
    </div>
  )
}

