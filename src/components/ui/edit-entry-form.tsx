'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { updateEntry } from '@/lib/actions/entries'
import { uploadFile } from '@/lib/actions/files'
import { titleCaseWords } from '@/lib/title-case'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import { SubscriptionFields } from './subscription-fields'
import { SsnField, PhoneField } from './copyable-fields'
import { entryTypeHasPhone } from '@/lib/entry-fields'
import { FORM_SUGGESTIONS } from '@/lib/family-config'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries, categories, subcategories } from '@/lib/db/schema'
import { useFormAutosave, formatSavedAt } from './use-form-autosave'
import { CreditCardScanner } from './credit-card-scanner'
import { VehicularFieldsBlock, isVehicularKind, type VehicularProfile } from './vehicular-fields-block'

type Entry = InferSelectModel<typeof entries>
type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

interface CreditCardOption { id: string; label: string; network: string | null }

interface Props {
  entry: Entry
  categories: Category[]
  subcategories: Subcategory[]
  /** Visible credit-card entries that can be picked as the payment method. */
  creditCards?: CreditCardOption[]
  /** When the entry is filed under this subcategory, the "Paid with" dropdown shows. */
  subscriptionsSubcategoryId?: string | null
  isSuperuser: boolean
  /** Per-user favorite state. Controls the Favorite checkbox default — favorites
   *  are now stored in entry_favorite, not the legacy entries.is_favorite column. */
  userFavorited?: boolean
  /** Family roster — used by the Asset block's "Driver" dropdown when
   *  the kind is vehicular. Defaults to [] so non-asset edits don't
   *  need to pass it. */
  familyProfiles?: VehicularProfile[]
}

export function EditEntryForm({ entry, categories, subcategories, creditCards = [], subscriptionsSubcategoryId, isSuperuser, userFavorited = false, familyProfiles = [] }: Props) {
  const router = useRouter()
  const [categoryId, setCategoryId] = useState(entry.categoryId)
  const [subcategoryId, setSubcategoryId] = useState(entry.subcategoryId ?? '')
  const [paidWith, setPaidWith] = useState((entry.customFields?.paidWith as string | undefined) ?? '')
  // Free-text companion to paidWith — see new-entry-form for rationale.
  // Stored at customFields.paidWithUrl; rendered next to the dropdown.
  const [paidWithUrl, setPaidWithUrl] = useState((entry.customFields?.paidWithUrl as string | undefined) ?? '')
  // Asset Kind tracked so the vehicular block (VIN / plate / driver /
  // insurance / reg expiry) can conditionally render when the user
  // edits a Car / Truck / etc. Initialized from the entry's saved
  // accountType so re-opening the form shows the block immediately.
  const [assetKind, setAssetKind] = useState(entry.accountType ?? '')
  // Scanner overrides for the credit-card fields. When set, they take
  // precedence over the entry's stored values via key+defaultValue.
  const [scannedCard, setScannedCard] = useState<{ cardholderName?: string; cardNumber?: string; expiryDate?: string; cardNetwork?: string }>({})
  const [scanCount, setScanCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [recurring, setRecurring] = useState(entry.isRecurring)

  const filteredSubs = subcategories.filter((s) => s.categoryId === categoryId)
  const activeCategorySlug = categories.find((c) => c.id === categoryId)?.slug ?? ''
  // LLC tag picker — bank_account / credit_card only. See new-entry-form
  // for the rationale; this just renders the saved value on edit.
  const receiptsCategoryId = categories.find((c) => c.slug === 'receipts')?.id ?? null
  const llcOptions = receiptsCategoryId
    ? subcategories.filter((s) => s.categoryId === receiptsCategoryId)
    : []
  const showLlcPicker = entry.type === 'bank_account' || entry.type === 'credit_card'

  const save = useCallback((fd: FormData) => updateEntry(entry.id, fd), [entry.id])
  const isErr = useCallback((r: { error?: string } | undefined) => !!r?.error, [])
  const { formRef, dirty, lastSavedAt, onFormChange, markClean } = useFormAutosave({
    save,
    isError: isErr,
  })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateEntry(entry.id, formData)

    setLoading(false)

    if (result?.error) {
      setError(result.error)
    } else {
      markClean()
      setSaved(true)
      setTimeout(() => {
        router.push(`/entries/${entry.id}`)
        router.refresh()
      }, 800)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={onFormChange} className="space-y-5">
      {/* Sticky title + save row. Heading lives here (not on the page) so the
          save icon shares the same line and doesn't waste a row on mobile. */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 -mx-8 px-8 py-3 bg-stone-900/90 backdrop-blur border-b border-stone-800/60">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-stone-100 leading-tight">Edit Entry</h1>
          <div className="text-xs text-stone-500 flex items-center gap-1.5 min-w-0 truncate mt-0.5">
            {dirty ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="truncate">Unsaved · autosaves every 30s</span>
              </>
            ) : lastSavedAt ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">Saved at {formatSavedAt(lastSavedAt)}</span>
              </>
            ) : (
              <span className="truncate">Changes are saved immediately.</span>
            )}
          </div>
        </div>
        {/* Mobile: square save icon */}
        <button
          type="submit"
          disabled={loading || saved}
          aria-label="Save changes"
          title="Save changes"
          className="md:hidden inline-flex items-center justify-center w-12 h-12 rounded-lg disabled:opacity-50 transition active:scale-95 shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/cobb/icons/system/original_save_icon.png" alt="" className="block w-12 h-12 object-contain" />
        </button>
        {/* Desktop: wider styled button */}
        <button
          type="submit"
          disabled={loading || saved}
          className="hidden md:flex items-center gap-1.5 px-4 py-1.5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition shrink-0 self-center"
        >
          {loading ? 'Saving...' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
      </div>

      {/* Scanner — hoisted above Title so it's the first thing under the
          page header. Previously sat below Category/LLC pickers and was
          easy to miss without scrolling. */}
      {entry.type === 'credit_card' && (
        <CreditCardScanner
          onScan={(p, file) => {
            setScannedCard({
              cardholderName: p.cardholderName,
              cardNumber: p.cardNumber,
              expiryDate: p.expiryDate,
              cardNetwork: p.cardNetwork,
            })
            setScanCount((c) => c + 1)
            // Entry already exists — upload the photo right away as an
            // attachment. Failure is non-blocking; we just log.
            ;(async () => {
              try {
                const fd = new FormData()
                fd.append('file', file)
                fd.append('entryId', entry.id)
                fd.append('isPrivate', entry.isPrivate ? 'true' : 'false')
                const up = await uploadFile(fd)
                if (up?.error) console.warn('[edit-entry] card photo upload failed:', up.error)
                else router.refresh()
              } catch (err) {
                console.warn('[edit-entry] card photo upload threw:', err)
              }
            })()
          }}
        />
      )}

      <Field label="Title *" name="title" required autoTitleCase defaultValue={entry.title ?? ''} />

      {/* Type — switching this changes which type-specific fields
          appear below (password vs. account #, etc.). The underlying
          data in the DB is preserved on switch (nothing is wiped), so
          flipping back-and-forth is safe. Useful for things like
          domain entries that were created as "login" but really fit
          better as "note" or "document". */}
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          Type
          <span className="text-stone-500 font-normal text-xs ml-1.5">(controls which fields show below)</span>
        </label>
        <select
          name="type"
          defaultValue={entry.type}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        >
          <option value="login">Login (username, password, URL)</option>
          <option value="note">Note (just title + body)</option>
          <option value="document">Document (a thing you own — IDs, domains, certs, registrations)</option>
          <option value="bank_account">Bank Account (routing, account #)</option>
          <option value="credit_card">Credit Card (card #, CVV, expiry)</option>
          <option value="identity">Identity (SSN, passport, driver's license)</option>
          <option value="asset">Asset (house, car, jewelry — manual value)</option>
        </select>
        <p className="mt-1 text-[11px] text-stone-500 leading-snug">
          Changing the type is safe — your existing data stays in the database, just hidden if it doesn&rsquo;t fit the new type. You can switch back any time and see it again.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Category *</label>
          <select
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId('') }}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {filteredSubs.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Subcategory</label>
            <select
              name="subcategoryId"
              value={subcategoryId}
              onChange={(e) => setSubcategoryId(e.target.value)}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            >
              <option value="">None</option>
              {filteredSubs.map((s) => (
                <option key={s.id} value={s.id}>{getSubcategoryLabel(activeCategorySlug, s.name)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* LLC tag — bank_account / credit_card only. Drives where detected
          recurring charges + statement attachments associate so business
          spend rolls up under the right LLC tile. Personal accounts leave
          this blank. */}
      {showLlcPicker && llcOptions.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">
            Associate with LLC <span className="text-stone-500 font-normal">(optional)</span>
          </label>
          <select
            name="llcSubcategoryId"
            defaultValue={entry.llcSubcategoryId ?? ''}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">(none — personal)</option>
            {llcOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Paid with (standalone location) — shown ONLY for Subscriptions
          entries that haven't been marked recurring. When recurring is
          ticked, SubscriptionFields renders its own Paid-with inside the
          green Recurring Detail box so the inputs sit next to Amount /
          Period / Renewal. Stored in customFields.paidWith server-side. */}
      {subscriptionsSubcategoryId && subcategoryId === subscriptionsSubcategoryId && !recurring ? (
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Paid with</label>
          <select
            name="paidWith"
            value={paidWith}
            onChange={(e) => setPaidWith(e.target.value)}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">— pick one —</option>
            {creditCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}{c.network ? ` (${c.network})` : ''}
              </option>
            ))}
            {/* Preserve a value that's not in the visible list (e.g. card
                was deleted, or user can't see it because it's private) so
                autosave doesn't blow it away accidentally. */}
            {paidWith && paidWith !== 'other' && !creditCards.find((c) => c.id === paidWith) && (
              <option value={paidWith}>(card no longer visible)</option>
            )}
            <option value="other">Other (cash / debit / not on file)</option>
          </select>
          {creditCards.length === 0 && (
            <p className="mt-1 text-[11px] text-stone-500">
              No credit cards in the vault yet — add one under Finance and it&rsquo;ll show up here.
            </p>
          )}
          {/* Free-text URL companion — see new-entry-form.tsx for
              rationale. Stored at customFields.paidWithUrl. */}
          <input
            type="url"
            name="paidWithUrl"
            value={paidWithUrl}
            onChange={(e) => setPaidWithUrl(e.target.value)}
            placeholder="Or paste a URL — e.g. https://paypal.com"
            className="mt-2 w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
      ) : !recurring ? (
        // Not subs and not recurring — send empty paidWith / paidWithUrl
        // so the server can clear any stale values. Skipped when recurring
        // because SubscriptionFields owns the real inputs in that case;
        // duplicating with name=paidWith would shadow the live value.
        <>
          <input type="hidden" name="paidWith" value="" />
          <input type="hidden" name="paidWithUrl" value="" />
        </>
      ) : null}

      {/* Login + app_login share the same fields (username/password/url).
          app_login is just the "this credential is for an app, not a
          website" flag — render block stays unified. */}
      {(entry.type === 'login' || entry.type === 'app_login') && (
        <>
          <Field label="Username / Email" name="username" defaultValue={entry.username ?? ''} />
          <Field label="Password" name="password" type="text" defaultValue={entry.password ?? ''} />
          <UrlField name="url" defaultValue={entry.url ?? ''} />
        </>
      )}

      {/* Bank Account */}
      {entry.type === 'bank_account' && (
        <>
          <ComboField label="Bank Name" name="bankName" defaultValue={entry.bankName ?? ''} options={BANK_NAMES} />
          <Field label="Account Type" name="accountType" defaultValue={entry.accountType ?? ''} />
          <Field label="Account Number" name="accountNumber" defaultValue={entry.accountNumber ?? ''} inputMode="numeric" />
          <Field label="Routing Number" name="routingNumber" defaultValue={entry.routingNumber ?? ''} inputMode="numeric" />
          {/* Online banking login — Username + Password ComboFields
              mirror the same dropdowns the login (password) entry uses.
              Defaults pre-fill from the entry so existing values
              round-trip. */}
          <ComboField
            label="Username / Email"
            name="username"
            defaultValue={entry.username ?? ''}
            options={FAMILY_EMAILS}
            placeholder="Online banking login"
          />
          <ComboField
            label="Password"
            name="password"
            defaultValue={entry.password ?? ''}
            options={PASSWORD_HINTS}
            placeholder="Password or hint..."
          />
        </>
      )}

      {/* Asset — house, car, jewelry, etc. Value field doubles as an
          appraisal trigger: bumping it appends a balance_history snapshot
          server-side, so the net-worth chart walks forward over time.
          Purchase value + date are reference-only (basis tracking) and
          live in customFields.purchaseValueCents / purchaseDate. */}
      {entry.type === 'asset' && (
        <>
          <Field
            label="Asset Kind"
            name="accountType"
            defaultValue={entry.accountType ?? ''}
            placeholder="House, Car, Jewelry..."
            onChange={setAssetKind}
          />
          <div className="grid grid-cols-2 gap-4">
            <DollarField
              label="Current Value (USD)"
              name="assetValueDollars"
              defaultValue={entry.currentBalance != null ? (entry.currentBalance / 100).toFixed(2) : ''}
              placeholder="450,000"
            />
            <DatePickerField
              label="Valued As Of"
              name="assetValueAsOf"
              defaultValue={formatDateYYYYMMDD(entry.balanceAsOf)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DollarField
              label="Purchase Value"
              name="purchaseValueDollars"
              defaultValue={readPurchaseValueDollars(entry.customFields)}
              placeholder="380,000"
            />
            <DatePickerField
              label="Purchase Date"
              name="purchaseDate"
              defaultValue={toISODateInput(entry.customFields?.purchaseDate)}
            />
          </div>
          {isVehicularKind(assetKind) && (
            <VehicularFieldsBlock
              familyProfiles={familyProfiles}
              defaults={{
                vin: entry.customFields?.vin ?? undefined,
                licensePlate: entry.customFields?.licensePlate ?? undefined,
                driverUserId: entry.customFields?.driverUserId ?? undefined,
                insuranceAccountNumber: entry.customFields?.insuranceAccountNumber ?? undefined,
                registrationExpiry: toISODateInput(entry.customFields?.registrationExpiry),
                mileageHistory: entry.customFields?.mileageHistory ?? undefined,
              }}
            />
          )}
          <p className="text-xs text-stone-500 -mt-2">
            Bump the Current Value any time and a snapshot is logged — your net-worth card picks it up automatically. Purchase value + date are kept for reference (basis tracking).
          </p>
        </>
      )}

      {/* Credit Card */}
      {entry.type === 'credit_card' && (
        <>
          {/* Scanner lives above Title so users see it without scrolling. */}
          <ComboField
            key={`name-${scanCount}`}
            label="Cardholder Name"
            name="cardholderName"
            options={CARD_NAMES}
            defaultValue={scannedCard.cardholderName ?? entry.cardholderName ?? ''}
          />
          <Field
            key={`net-${scanCount}`}
            label="Network"
            name="cardNetwork"
            defaultValue={scannedCard.cardNetwork ?? entry.cardNetwork ?? ''}
          />
          <Field
            key={`num-${scanCount}`}
            label="Card Number"
            name="cardNumber"
            defaultValue={scannedCard.cardNumber ?? entry.cardNumber ?? ''}
            inputMode="numeric"
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              key={`exp-${scanCount}`}
              label="Expiry"
              name="expiryDate"
              defaultValue={scannedCard.expiryDate ?? entry.expiryDate ?? ''}
              inputMode="numeric"
            />
            <Field label="CVV" name="cvv" defaultValue={entry.cvv ?? ''} inputMode="numeric" />
          </div>
        </>
      )}

      {/* Identity */}
      {entry.type === 'identity' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name" name="firstName" defaultValue={entry.firstName ?? ''} />
            <Field label="Last Name" name="lastName" defaultValue={entry.lastName ?? ''} />
          </div>
          <Field label="Date of Birth" name="dateOfBirth" defaultValue={entry.dateOfBirth ?? ''} inputMode="numeric" />
          <SsnField defaultValue={entry.ssn ?? ''} />
          <Field label="Passport #" name="passport" defaultValue={entry.passport ?? ''} />
          <Field label="Driver&rsquo;s License #" name="driversLicense" defaultValue={entry.driversLicense ?? ''} />
        </>
      )}

      {/* Phone — only on entry types where a contact number is meaningful
          (logins, cards, banks, identity records). Assets / notes /
          documents skip it so the form isn't padded with an always-
          empty row. Mirror new-entry-form's policy via the shared
          entryTypeHasPhone helper so the two stay in lockstep. */}
      {entryTypeHasPhone(entry.type) && (
        <PhoneField name="phone" defaultValue={entry.phone ?? ''} />
      )}

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          {entry.type === 'note' ? 'Content' : 'Notes'}
        </label>
        <textarea
          name="noteContent"
          rows={4}
          defaultValue={entry.noteContent ?? ''}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-none"
        />
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
          <input
            type="checkbox"
            name="isFavorite"
            value="true"
            defaultChecked={userFavorited}
            className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
          />
          Favorite
        </label>
        <label className="flex items-center gap-2 text-sm text-emerald-300 cursor-pointer">
          <input
            type="checkbox"
            name="isRecurring"
            value="true"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
          />
          Recurring bill
        </label>
        <label className="flex items-center gap-2 text-sm text-amber-400 cursor-pointer">
          <input
            type="checkbox"
            name="isPersonal"
            value="true"
            defaultChecked={entry.isPersonal}
            className="rounded border-stone-600 bg-stone-800 text-amber-600 focus:ring-amber-600"
          />
          Personal (only you)
        </label>
        {isSuperuser && (
          <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
            <input
              type="checkbox"
              name="isPrivate"
              value="true"
              defaultChecked={entry.isPrivate}
              className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
            />
            Private
          </label>
        )}
        {(entry.type === 'login' || entry.type === 'app_login') && (
          <label
            className="flex items-center gap-2 text-sm text-sky-300 cursor-pointer"
            title="When the browser extension lands on this exact site, fill the password automatically — no click needed. Only the browser extension respects this flag."
          >
            <input
              type="checkbox"
              name="autofillOnLoad"
              value="true"
              defaultChecked={entry.autofillOnLoad}
              className="rounded border-stone-600 bg-stone-800 text-sky-600 focus:ring-sky-600"
            />
            Auto-fill on load
          </label>
        )}
      </div>

      {recurring && (
        <SubscriptionFields
          defaultAmountCents={entry.subscriptionAmountCents}
          defaultPeriod={entry.subscriptionPeriod}
          defaultStartedAt={entry.subscriptionStartedAt}
          defaultRenewsAt={entry.subscriptionRenewsAt}
          paidWith={paidWith}
          setPaidWith={setPaidWith}
          paidWithUrl={paidWithUrl}
          setPaidWithUrl={setPaidWithUrl}
          creditCards={creditCards}
        />
      )}

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {saved && (
        <div className="text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">
          Saved! Redirecting...
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading || saved}
          className="flex-1 py-2.5 px-4 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
        >
          {loading ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="py-2.5 px-4 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 font-medium rounded-lg transition text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

const BANK_NAMES = ['Bank of America', 'Axos', 'Bluevine', 'Bank of America - PTC', 'SoFi']
const FAMILY_EMAILS = FORM_SUGGESTIONS.emails
const PASSWORD_HINTS = FORM_SUGGESTIONS.passwordHints

const CARD_NAMES = [
  'Demo Owner',
  'Demo Partner',
  'Demo Member',
  'Demo Member',
  'Demo Member',
  'Demo Member',
]

// Format a stored Date (balanceAsOf / valuedAsOf) into YYYY-MM-DD for
// the native <input type="date"> default. Reads in UTC to stay
// consistent with how the server records appraisal snapshots (noon
// UTC, see actions/entries.ts createEntry/updateEntry).
function formatDateYYYYMMDD(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${mm}-${dd}`
}

// Convert a stored MM/DD/YYYY string (legacy customFields.purchaseDate
// from rows created before the date-picker swap) into YYYY-MM-DD so
// <input type="date"> can render it. Pass-through anything that's
// already ISO or empty.
function toISODateInput(raw: string | null | undefined): string {
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[1]}-${m[2]}`
  return ''
}

// Pull purchaseValueCents out of customFields and render as a dollar
// string for the DollarField default ("380000" cents → "3800.00").
function readPurchaseValueDollars(cf: Record<string, string> | null | undefined): string {
  const raw = cf?.purchaseValueCents
  if (!raw) return ''
  const cents = Number(raw)
  if (!Number.isFinite(cents)) return ''
  return (cents / 100).toFixed(2)
}

// Currency input with a static "$" prefix glyph. Used in the Asset edit
// block — server-side strips $/, so the input value can stay just digits.
function DollarField({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string
  name: string
  defaultValue?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
        <input
          type="text"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          inputMode="decimal"
          className="w-full pl-7 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
    </div>
  )
}

// Native date picker. <input type="date"> renders a calendar UI on
// every modern browser/mobile keyboard. Stored value is YYYY-MM-DD; the
// server parser also still accepts MM/DD/YYYY legacy strings.
function DatePickerField({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
      />
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  inputMode,
  autoTitleCase,
  placeholder,
  onChange,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url'
  /** Title-case the input value when the field loses focus. */
  autoTitleCase?: boolean
  placeholder?: string
  /** Optional reactive callback — when set, the field reports its value
   *  to the parent on every keystroke. Used by the Asset Kind input so
   *  the vehicular fields block can render conditionally. */
  onChange?: (value: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        inputMode={inputMode}
        placeholder={placeholder}
        autoCapitalize={autoTitleCase ? 'words' : undefined}
        onChange={onChange ? (e) => onChange(e.currentTarget.value) : undefined}
        onBlur={autoTitleCase ? (e) => { e.currentTarget.value = titleCaseWords(e.currentTarget.value) } : undefined}
        className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
      />
    </div>
  )
}


function UrlField({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? '')

  function handleFocus() {
    if (!value) setValue('https://www.')
  }

  function handleBlur() {
    if (value === 'https://www.' || value === 'https://www') setValue('')
  }

  const hasUrl = value.length > 12 && value.startsWith('http')

  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">URL</label>
      <div className="flex gap-2">
        <input
          type="text"
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="https://www.example.com"
          className="flex-1 px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
        {hasUrl && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
            className="px-3 py-2.5 bg-stone-700 hover:bg-stone-600 border border-stone-600 rounded-lg text-stone-300 hover:text-emerald-400 transition flex items-center shrink-0"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>
    </div>
  )
}

function ComboField({
  label,
  name,
  options,
  defaultValue,
  placeholder,
}: {
  label: string
  name: string
  options: string[]
  defaultValue?: string
  placeholder?: string
}) {
  const [value, setValue] = useState(defaultValue ?? '')
  const [open, setOpen] = useState(false)
  const [typing, setTyping] = useState(false)

  const filtered = options.filter((o) =>
    value === '' || o.toLowerCase().includes(value.toLowerCase())
  )

  function handleClick() {
    if (!open) { setOpen(true); setTyping(false) }
    else if (!typing) setTyping(true)
  }

  function handleSelect(opt: string) {
    setValue(opt); setOpen(false); setTyping(false)
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        readOnly={!typing}
        autoComplete="off"
        onChange={typing ? (e) => { setValue(e.target.value); setOpen(true) } : undefined}
        onClick={handleClick}
        onBlur={() => setTimeout(() => { setOpen(false); setTyping(false) }, 150)}
        className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition cursor-pointer"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-stone-800 border border-stone-600 rounded-lg shadow-xl overflow-hidden">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 text-sm text-stone-300 hover:bg-stone-700 hover:text-stone-100 transition border-b border-stone-700/50 last:border-0"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
