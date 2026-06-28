'use client'

import { createContext, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { createEntry } from '@/lib/actions/entries'
import { uploadFile } from '@/lib/actions/files'
import { titleCaseWords } from '@/lib/title-case'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import { FORM_SUGGESTIONS } from '@/lib/family-config'
import { ExistingEntryAlert } from './existing-entry-alert'
import { useUnsavedGuard } from './use-unsaved-guard'
import { SubscriptionFields } from './subscription-fields'
import { CreditCardScanner } from './credit-card-scanner'
import { IdentityDocumentScanner } from './identity-document-scanner'
import { SsnField, PhoneField } from './copyable-fields'
import { entryTypeHasPhone } from '@/lib/entry-fields'
import { VehicularFieldsBlock, isVehicularKind } from './vehicular-fields-block'
import type { ParsedIdentityFields } from '@/lib/ocr-field-types'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories, subcategories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

type EntryType = 'login' | 'app_login' | 'note' | 'document' | 'bank_account' | 'credit_card' | 'identity' | 'asset'

// `app_login` is structurally identical to `login` (username + password +
// optional URL) but flags the credential as belonging to a mobile/desktop
// app rather than a website. Same form fields, separate type so the
// sidebar's /apps page can list them on their own and the entry icon
// reads as "App" instead of "Login" everywhere it surfaces.
const validEntryTypes: EntryType[] = ['login', 'app_login', 'note', 'document', 'bank_account', 'credit_card', 'identity', 'asset']

const ASSET_KIND_SUGGESTIONS = ['House', 'Car', 'Truck', 'Boat', 'Motorcycle', 'RV', 'Jewelry', 'Art', 'Collectible', 'Other']

// URL `?type=` values get resolved to an internal EntryType. `upload` is a
// header-only alias for `document` — same fields, different label/icon at
// the top of the page. Missing/unknown types become `note` so the user
// gets a clean title+content form instead of being defaulted into Login.
function resolveType(raw: string | undefined): EntryType {
  if (raw === 'upload') return 'document'
  if (raw && validEntryTypes.includes(raw as EntryType)) return raw as EntryType
  return 'note'
}

const CARD_NETWORKS = ['Visa', 'Mastercard', 'Debit', "Your Mom's Card", 'Amex', 'Discover']

// Per-type accent palette. Each entry kind has its own colored card icon
// on the dashboard (Add=amber, Upload=sky, etc.); the form's interactive
// accents (focus rings, save button, suggest pill, checkboxes) now match
// so the page reads as themed end-to-end instead of always-emerald.
//
// Each theme block bundles the Tailwind class strings used at the call
// sites — kept as literal strings so the JIT picks them up.
interface FormTheme {
  inputFocus: string   // focus:ring-… focus:border-…
  button: string       // primary submit (bg + hover + disabled)
  check: string        // checkbox text + ring
  subtleText: string   // accent-colored label / small text
  pillIdle: string     // "Suggest category" pill before activation
  pillFilled: string   // "Suggest category" → filled state mid-spin
  spinnerBorder: string
  hoverText: string    // small hover transitions on neutral chrome
}

const THEMES: Record<string, FormTheme> = {
  emerald: {
    inputFocus: 'focus:ring-emerald-600/50 focus:border-emerald-600',
    button: 'border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50',
    check: 'text-emerald-600 focus:ring-emerald-600',
    subtleText: 'text-emerald-300',
    pillIdle: 'bg-emerald-900/40 hover:bg-emerald-800/50 border-emerald-700/40 text-emerald-200',
    pillFilled: 'bg-emerald-700 hover:bg-emerald-600',
    spinnerBorder: 'border-emerald-200',
    hoverText: 'hover:text-emerald-400',
  },
  sky: {
    inputFocus: 'focus:ring-sky-600/50 focus:border-sky-600',
    button: 'bg-sky-700 hover:bg-sky-600 disabled:bg-sky-900',
    check: 'text-sky-600 focus:ring-sky-600',
    subtleText: 'text-sky-300',
    pillIdle: 'bg-sky-900/40 hover:bg-sky-800/50 border-sky-700/40 text-sky-200',
    pillFilled: 'bg-sky-700 hover:bg-sky-600',
    spinnerBorder: 'border-sky-200',
    hoverText: 'hover:text-sky-400',
  },
  amber: {
    inputFocus: 'focus:ring-amber-600/50 focus:border-amber-600',
    button: 'bg-amber-700 hover:bg-amber-600 disabled:bg-amber-900',
    check: 'text-amber-600 focus:ring-amber-600',
    subtleText: 'text-amber-300',
    pillIdle: 'bg-amber-900/40 hover:bg-amber-800/50 border-amber-700/40 text-amber-200',
    pillFilled: 'bg-amber-700 hover:bg-amber-600',
    spinnerBorder: 'border-amber-200',
    hoverText: 'hover:text-amber-400',
  },
  violet: {
    inputFocus: 'focus:ring-violet-600/50 focus:border-violet-600',
    button: 'bg-violet-700 hover:bg-violet-600 disabled:bg-violet-900',
    check: 'text-violet-600 focus:ring-violet-600',
    subtleText: 'text-violet-300',
    pillIdle: 'bg-violet-900/40 hover:bg-violet-800/50 border-violet-700/40 text-violet-200',
    pillFilled: 'bg-violet-700 hover:bg-violet-600',
    spinnerBorder: 'border-violet-200',
    hoverText: 'hover:text-violet-400',
  },
  rose: {
    inputFocus: 'focus:ring-rose-600/50 focus:border-rose-600',
    button: 'bg-rose-700 hover:bg-rose-600 disabled:bg-rose-900',
    check: 'text-rose-600 focus:ring-rose-600',
    subtleText: 'text-rose-300',
    pillIdle: 'bg-rose-900/40 hover:bg-rose-800/50 border-rose-700/40 text-rose-200',
    pillFilled: 'bg-rose-700 hover:bg-rose-600',
    spinnerBorder: 'border-rose-200',
    hoverText: 'hover:text-rose-400',
  },
}

function themeForType(_t: EntryType): FormTheme {
  // Reverted — Lance preferred the unified emerald look across all add
  // pages. The per-type palette mapping below is intentionally bypassed;
  // restore by switching on `_t` again if you want it back.
  //   case 'login': return THEMES.amber
  //   case 'document': return THEMES.sky
  //   case 'note' | 'credit_card': return THEMES.violet
  //   case 'identity': return THEMES.rose
  //   default: return THEMES.emerald
  return THEMES.emerald
}

// Context lets the helper subcomponents (Field/ComboField/MaskedField/
// UrlField/PersonPicker/CategorySuggestionPill) read the active theme
// without each one taking a theme prop. NewEntryForm wraps its render
// in a Provider; subcomponents call useTheme().
const FormThemeContext = createContext<FormTheme>(THEMES.emerald)
function useTheme(): FormTheme {
  return useContext(FormThemeContext)
}

// Sentinel value for the "+ New subcategory" option in the subcategory
// dropdown. Picking it reveals a name input; the server (createEntry)
// creates the subcategory from `newSubcategoryName` instead of using an id.
const NEW_SUB = '__new__'

// Suggestion lists are family-specific — keep them in family-config.ts so
// a fork can swap them without grepping component code. First tap shows
// the list, second tap lets you free-type anything not on it.
const CARD_NAMES = FORM_SUGGESTIONS.cardholderNames
const FAMILY_EMAILS = FORM_SUGGESTIONS.emails
const PASSWORD_HINTS = FORM_SUGGESTIONS.passwordHints
const BANK_NAMES = FORM_SUGGESTIONS.bankNames

function splitName(name?: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: undefined, last: 'Cobb' }
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : 'Cobb' }
}

function profileEmails(profiles: FamilyProfile[]) {
  return Array.from(new Set([...profiles.map((p) => p.email).filter((e): e is string => !!e), ...FAMILY_EMAILS]))
}

function profileNames(profiles: FamilyProfile[]) {
  return Array.from(new Set([...profiles.map((p) => p.name).filter(Boolean), ...CARD_NAMES]))
}

// After a select changes, find the next focusable form control inside the
// same <form> and scroll it into view (and focus it on desktop). Saves the
// user from manually scrolling on mobile after picking a category.
function advanceFocus(current: HTMLElement) {
  const form = current.closest('form')
  if (!form) return
  const focusables = Array.from(
    form.querySelectorAll<HTMLElement>('input, select, textarea, button')
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1 && el.offsetParent !== null)
  const idx = focusables.indexOf(current)
  const next = idx >= 0 ? focusables[idx + 1] : null
  if (!next) return
  next.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Don't auto-focus inputs on touch devices — that pops the keyboard
  // immediately, which is annoying when the user just wanted to see the
  // field, not type into it. Desktop is fine.
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches
  if (!isTouch && typeof (next as HTMLInputElement).focus === 'function') {
    next.focus({ preventScroll: true })
  }
}

// ─── Auto-formatters ──────────────────────────────────────────────────────────

function fmtExpiry(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

function fmtCardNumber(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 16)
  return d.match(/.{1,4}/g)?.join('-') ?? d
}

function fmtDOB(raw: string) {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreditCardOption { id: string; label: string; network: string | null }
interface FamilyProfile {
  id: string
  name: string
  email: string | null
  dateOfBirth: string | null
  phone: string | null
  address: string | null
  ssn: string | null
  driversLicense: string | null
  passport: string | null
}

interface Props {
  categories: Category[]
  subcategories: Subcategory[]
  /** Visible credit-card entries that can be picked as the payment method. */
  creditCards?: CreditCardOption[]
  familyProfiles?: FamilyProfile[]
  currentUserId?: string
  /** When the user picks this subcategory, the "Paid with" dropdown shows up. */
  subscriptionsSubcategoryId?: string | null
  defaultCategoryId?: string
  defaultSubcategoryId?: string
  defaultIsPrivate?: boolean
  defaultIsPersonal?: boolean
  defaultIsRecurring?: boolean
  isSuperuser: boolean
  defaultType?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NewEntryForm({ categories, subcategories, creditCards = [], familyProfiles = [], currentUserId, subscriptionsSubcategoryId, defaultCategoryId, defaultSubcategoryId, defaultIsPrivate, defaultIsPersonal, defaultIsRecurring, isSuperuser, defaultType }: Props) {
  const router = useRouter()
  const [type] = useState<EntryType>(resolveType(defaultType))
  const theme = themeForType(type)
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? '')
  const [subcategoryId, setSubcategoryId] = useState(defaultSubcategoryId ?? '')
  const [paidWith, setPaidWith] = useState('')
  const [paidWithUrl, setPaidWithUrl] = useState('')
  const [selectedPersonId, setSelectedPersonId] = useState(currentUserId ?? familyProfiles[0]?.id ?? '')
  const [cardNetwork, setCardNetwork] = useState('')
  // Scanned card values come from CreditCardScanner. We keep them in their
  // own state, then bump scanCount so the Cardholder/CardNumber/Expiry
  // inputs remount with the scanned defaults — they're otherwise
  // uncontrolled, so this is the simplest way to write into them.
  const [scannedCard, setScannedCard] = useState<{ cardholderName?: string; cardNumber?: string; expiryDate?: string }>({})
  // The actual photo file captured during the scan. Held until the entry
  // is saved, then uploaded as an attachment to that new entry.
  const [scannedCardFile, setScannedCardFile] = useState<File | null>(null)
  const [scannedIdentity, setScannedIdentity] = useState<ParsedIdentityFields>({})
  const [scannedIdentityFile, setScannedIdentityFile] = useState<File | null>(null)
  const [scanCount, setScanCount] = useState(0)
  const [identityScanCount, setIdentityScanCount] = useState(0)
  // Claude-suggested entry title from the scan (credit-card brand + first
  // name, or "<Name> Driver's License" for IDs). Bumped together with the
  // scanCount so the Title field remounts with this value pre-filled.
  // User can edit it like any other text — it's just a defaultValue.
  const [scannedTitle, setScannedTitle] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recurring, setRecurring] = useState(defaultIsRecurring ?? false)
  const [saveAndNew, setSaveAndNew] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  // Asset Kind is tracked so the vehicular block (VIN / plate / driver /
  // insurance / reg expiry) can conditionally render when the user picks
  // Car / Truck / etc. ComboField exposes its value via onChange.
  const [assetKind, setAssetKind] = useState('')
  const { dirty, markDirty, markClean } = useUnsavedGuard()

  const filteredSubs = subcategories.filter((s) => s.categoryId === categoryId)
  const activeCategorySlug = categories.find((c) => c.id === categoryId)?.slug ?? ''
  // LLC tag — only meaningful on account-type entries. Sourced from the
  // Receipts category's subcategories (the canonical LLC list: Path to
  // Change LLC, H&L Havens, CFS, PTC Havens, Place of Grace). Tag is
  // orthogonal to category/subcategory; an account stays filed under
  // Finances while being tagged with its LLC.
  const receiptsCategoryId = categories.find((c) => c.slug === 'receipts')?.id ?? null
  const llcOptions = receiptsCategoryId
    ? subcategories.filter((s) => s.categoryId === receiptsCategoryId)
    : []
  const showLlcPicker = type === 'bank_account' || type === 'credit_card'
  const selectedPerson = familyProfiles.find((p) => p.id === selectedPersonId)
  const selectedName = splitName(selectedPerson?.name)
  const selectedDob = selectedPerson?.dateOfBirth ?? undefined
  const personKey = selectedPersonId || 'manual'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await createEntry(formData)

    setLoading(false)

    if (result?.error) {
      setError(result.error)
      return
    }

    // If the user scanned a card/ID photo, attach it to the new entry. Failure
    // here doesn't unwind the entry creation — it just logs and proceeds,
    // since the entry itself saved fine and the user can re-attach manually.
    if (result?.id && ((scannedCardFile && type === 'credit_card') || (scannedIdentityFile && type === 'identity'))) {
      try {
        const fd = new FormData()
        fd.append('file', type === 'identity' ? scannedIdentityFile! : scannedCardFile!)
        fd.append('entryId', result.id)
        fd.append('isPrivate', formData.get('isPrivate') === 'true' ? 'true' : 'false')
        const up = await uploadFile(fd)
        if (up?.error) console.warn('[new-entry] scan photo upload failed:', up.error)
      } catch (err) {
        console.warn('[new-entry] scan photo upload threw:', err)
      }
    }

    if (saveAndNew) {
      ;(e.target as HTMLFormElement).reset()
      // Type is fixed by the URL now — keep it as-is across Save & New so
      // the user adds another of the same kind they just created.
      setCardNetwork('')
      setScannedCard({})
      setScannedCardFile(null)
      setScannedIdentity({})
      setScannedIdentityFile(null)
      setScannedTitle(undefined)
      // If they just created a new subcategory inline, drop back to "None"
      // so the next entry doesn't reopen the name input.
      if (subcategoryId === NEW_SUB) setSubcategoryId('')
      setResetKey((k) => k + 1)
      markClean()
    } else {
      // Mark clean BEFORE navigating so the beforeunload handler doesn't
      // fire on the post-save router.push.
      markClean()
      router.push(result?.id ? `/entries/${result.id}` : '/dashboard')
      router.refresh()
    }
  }

  return (
    <FormThemeContext.Provider value={theme}>
    <form onSubmit={handleSubmit} onChange={markDirty} className="space-y-6">
      {dirty && (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-0 px-3 py-1.5 text-xs text-amber-200 bg-amber-950/40 border-y md:border md:rounded-md border-amber-700/40 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Not saved yet — tap Save Entry when you&rsquo;re done.
        </div>
      )}
      {/* Type is fixed by the URL (`?type=...`) — picker grid removed in
          favor of a per-type page header so users only see the fields that
          apply. The server action still needs the type, hence this hidden
          field. */}
      <input type="hidden" name="type" value={type} />

      {/* Scanner — hoisted to the top of the form for credit cards and
          identity docs so it's the first thing under the page title.
          Previously sat below Category/LLC pickers and was easy to miss
          without scrolling. State (scannedCard / scanCount) still drives
          the cardholder/number/expiry inputs further down the form. */}
      {type === 'credit_card' && (
        <CreditCardScanner
          onScan={(p, file) => {
            setScannedCard({
              cardholderName: p.cardholderName,
              cardNumber: p.cardNumber,
              expiryDate: p.expiryDate,
            })
            if (p.cardNetwork) setCardNetwork(p.cardNetwork)
            if (p.suggestedTitle) setScannedTitle(p.suggestedTitle)
            setScannedCardFile(file)
            setScanCount((c) => c + 1)
          }}
        />
      )}
      {type === 'identity' && (
        <IdentityDocumentScanner
          onScan={(p, file) => {
            setScannedIdentity(p)
            if (p.suggestedTitle) setScannedTitle(p.suggestedTitle)
            setScannedIdentityFile(file)
            setIdentityScanCount((c) => c + 1)
          }}
        />
      )}

      {/* Title — re-keyed by scan counters so a fresh scan remounts the
          input with Claude's suggested title (issuer + first name for
          credit cards; full name + doc type for IDs). User can still type
          over it freely; we just give them a head start. */}
      <Field
        key={`title-${scanCount}-${identityScanCount}`}
        label="Title *"
        name="title"
        required
        autoTitleCase
        placeholder={type === 'document' ? 'Insurance card, deed, passport scan...' : 'Gmail, Netflix, Bluevine, cabin Wi-Fi...'}
        defaultValue={scannedTitle}
      />

      {/* Existing-entry alert — surfaces similar entries as the user
          types, so they can edit (and add recurring to) an existing one
          instead of accidentally creating a duplicate. */}
      <ExistingEntryAlert />

      {/* Category */}
      <CategorySuggestionPill
        type={type}
        categories={categories}
        subcategories={subcategories}
        onAccept={(catId, subId) => {
          setCategoryId(catId)
          setSubcategoryId(subId ?? '')
        }}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Category *</label>
          <select
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => {
              const next = e.target.value
              setCategoryId(next)
              // Switching category invalidates the picked subcategory.
              setSubcategoryId('')
              // After picking a category, scroll the next field into view so
              // the user doesn't have to swipe to find it on mobile.
              advanceFocus(e.target)
            }}
            className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {(filteredSubs.length > 0 || isSuperuser) && (
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Subcategory</label>
            <select
              name={subcategoryId === NEW_SUB ? undefined : 'subcategoryId'}
              value={subcategoryId}
              onChange={(e) => {
                const next = e.target.value
                setSubcategoryId(next)
                // Picking "+ New subcategory" reveals the name input below —
                // don't jump focus past it.
                if (next !== NEW_SUB) advanceFocus(e.target)
              }}
              className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
            >
              <option value="">None</option>
              {filteredSubs.map((s) => (
                <option key={s.id} value={s.id}>{getSubcategoryLabel(activeCategorySlug, s.name)}</option>
              ))}
              {isSuperuser && <option value={NEW_SUB}>+ New subcategory…</option>}
            </select>
            {subcategoryId === NEW_SUB && (
              <input
                type="text"
                name="newSubcategoryName"
                autoFocus
                placeholder="New subcategory name"
                className={`mt-2 w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
              />
            )}
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
            defaultValue=""
            className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
          >
            <option value="">(none — personal)</option>
            {llcOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Paid with (standalone location) — Subscriptions entries that
          haven't been marked recurring. Once Recurring is ticked,
          SubscriptionFields renders its own Paid-with inside the green
          Recurring Detail box so the inputs sit next to Amount / Period
          / Renewal. Stored in customFields.paidWith server-side. */}
      {subscriptionsSubcategoryId && subcategoryId === subscriptionsSubcategoryId && !recurring && (
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Paid with</label>
          <select
            name="paidWith"
            value={paidWith}
            onChange={(e) => { setPaidWith(e.target.value); advanceFocus(e.target) }}
            className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
          >
            <option value="">— pick one —</option>
            {creditCards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}{c.network ? ` (${c.network})` : ''}
              </option>
            ))}
            <option value="other">Other (cash / debit / not on file)</option>
          </select>
          {creditCards.length === 0 && (
            <p className="mt-1 text-[11px] text-stone-500">
              No credit cards in the vault yet — add one under Finance and it&rsquo;ll show up here.
            </p>
          )}
          {/* Free-text URL companion — for when the funding source is a
              website (PayPal, the registrar's billing page) rather than
              a vault credit card. Optional; stored as
              customFields.paidWithUrl and surfaced wherever paidWith is. */}
          <input
            type="url"
            name="paidWithUrl"
            value={paidWithUrl}
            onChange={(e) => setPaidWithUrl(e.target.value)}
            placeholder="Or paste a URL — e.g. https://paypal.com"
            className={`mt-2 w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
          />
        </div>
      )}

      {/* Type-specific fields */}
      {(type === 'login' || type === 'app_login') && (
        <>
          <PersonPicker
            profiles={familyProfiles}
            value={selectedPersonId}
            onChange={setSelectedPersonId}
          />
          <ComboField
            key={`login-email-${personKey}`}
            label="Username / Email"
            name="username"
            options={profileEmails(familyProfiles)}
            placeholder="Some long email your Dad made"
            defaultValue={selectedPerson?.email ?? undefined}
          />
          <ComboField label="Password" name="password" options={PASSWORD_HINTS} placeholder="Password or hint..." />
          <UrlField name="url" />
        </>
      )}

      {type === 'bank_account' && (
        <>
          <ComboField label="Bank Name" name="bankName" options={BANK_NAMES} placeholder="Axos, Bluevine, BofA..." />
          <Field label="Account Type" name="accountType" placeholder="Checking, Savings..." />
          <Field label="Account Number" name="accountNumber" placeholder="•••• ••••" inputMode="numeric" />
          <Field label="Routing Number" name="routingNumber" placeholder="021000021" inputMode="numeric" />
          {/* Online banking login — Lance wanted the same Username +
              Password autosuggest dropdowns the password (login) entry
              type ships with so he can attach banking credentials
              directly to the bank entry instead of needing a separate
              login row pointing at the same site. profileEmails and
              PASSWORD_HINTS are the same option sets the login section
              uses; no PersonPicker on banks (yet) so the email field
              doesn't auto-prefill — pick from the dropdown or type. */}
          <ComboField
            label="Username / Email"
            name="username"
            options={profileEmails(familyProfiles)}
            placeholder="Online banking login"
          />
          <ComboField label="Password" name="password" options={PASSWORD_HINTS} placeholder="Password or hint..." />
        </>
      )}

      {type === 'asset' && (
        <>
          <ComboField label="Asset Kind" name="accountType" options={ASSET_KIND_SUGGESTIONS} placeholder="House, Car, Jewelry..." onChange={setAssetKind} />
          <div className="grid grid-cols-2 gap-4">
            <DollarField label="Current Value (USD)" name="assetValueDollars" placeholder="450,000" />
            <DatePickerField label="Valued As Of" name="assetValueAsOf" defaultValue={todayYYYYMMDD()} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <DollarField label="Purchase Value" name="purchaseValueDollars" placeholder="380,000" />
            <DatePickerField label="Purchase Date" name="purchaseDate" />
          </div>
          {isVehicularKind(assetKind) && (
            <VehicularFieldsBlock familyProfiles={familyProfiles} />
          )}
          <p className="text-xs text-stone-500 -mt-2">
            Bump the Current Value any time and a snapshot is logged — your net-worth card picks it up automatically. Purchase value + date are kept for reference (basis tracking, capital-gains math down the road).
          </p>
        </>
      )}

      {type === 'credit_card' && (
        <>
          <PersonPicker
            profiles={familyProfiles}
            value={selectedPersonId}
            onChange={setSelectedPersonId}
          />

          {/* Scanner lives at the top of the form (above Title) so users
              see it without scrolling. The CVV is never printed on the
              card so it's not in the parsed fields either way. */}

          {/* Use scanCount in the keys so a fresh scan remounts these
              uncontrolled inputs with new defaults. */}
          <ComboField
            key={`name-${personKey}-${scanCount}`}
            label="Cardholder Name"
            name="cardholderName"
            options={profileNames(familyProfiles)}
            placeholder="Some kind of Cobb"
            defaultValue={scannedCard.cardholderName ?? selectedPerson?.name ?? undefined}
          />

          {/* Network dropdown */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Network</label>
            <select
              name="cardNetwork"
              value={cardNetwork}
              onChange={(e) => setCardNetwork(e.target.value)}
              className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg focus:outline-none focus:ring-2 ${theme.inputFocus} transition ${cardNetwork === '' ? 'text-stone-500' : 'text-stone-100'}`}
            >
              <option value="" className="text-stone-500">What kinda card you got?</option>
              {CARD_NETWORKS.map((n) => (
                <option key={n} value={n} className="text-stone-100">{n}</option>
              ))}
            </select>
          </div>

          {/* Card number with auto-dash */}
          <MaskedField
            key={`cc-${resetKey}-${scanCount}`}
            label="Card Number"
            name="cardNumber"
            placeholder="•••• - •••• - •••• - ••••"
            maxLength={19}
            formatter={fmtCardNumber}
            defaultValue={scannedCard.cardNumber}
          />

          <div className="grid grid-cols-2 gap-4">
            {/* Expiry with auto-slash */}
            <MaskedField
              key={`exp-${resetKey}-${scanCount}`}
              label="Expires"
              name="expiryDate"
              placeholder="MM/YY"
              maxLength={5}
              formatter={fmtExpiry}
              defaultValue={scannedCard.expiryDate}
            />
            <Field label="CVV" name="cvv" placeholder="•••" inputMode="numeric" />
          </div>
        </>
      )}

      {type === 'identity' && (
        <>
          <PersonPicker
            profiles={familyProfiles}
            value={selectedPersonId}
            onChange={setSelectedPersonId}
          />

          {/* Scanner lives at the top of the form (above Title). */}

          <div className="grid grid-cols-2 gap-4">
            <Field key={`first-${personKey}-${identityScanCount}`} label="First Name" name="firstName" placeholder="Cornanda" defaultValue={scannedIdentity.firstName ?? selectedName.first} />
            <Field key={`last-${personKey}-${identityScanCount}`} label="Last Name" name="lastName" placeholder="Cobb" defaultValue={scannedIdentity.lastName ?? selectedName.last ?? 'Cobb'} />
          </div>

          {/* DOB with auto-slash */}
          <MaskedField
            key={`dob-${resetKey}-${personKey}-${identityScanCount}`}
            label="Date of Birth"
            name="dateOfBirth"
            placeholder="MM/DD/YYYY"
            maxLength={10}
            formatter={fmtDOB}
            defaultValue={scannedIdentity.dateOfBirth ?? selectedDob}
          />

          {/* SSN with auto-dash + copy button */}
          <SsnField
            key={`ssn-${resetKey}-${identityScanCount}`}
            name="ssn"
            defaultValue={scannedIdentity.ssn ?? selectedPerson?.ssn ?? ''}
          />

          <Field key={`passport-${personKey}-${identityScanCount}`} label="Passport #" name="passport" placeholder="Gotta Get One to see the world" defaultValue={scannedIdentity.passport ?? selectedPerson?.passport ?? undefined} />
          <Field key={`dl-${personKey}-${identityScanCount}`} label="Driver's License #" name="driversLicense" placeholder="58-'Im Movin'" defaultValue={scannedIdentity.driversLicense ?? selectedPerson?.driversLicense ?? undefined} />
        </>
      )}

      {type === 'document' && (
        <div className="rounded-xl border border-sky-800/40 bg-sky-950/20 p-4 text-sm text-sky-100">
          After you save, use the attachment box on the document page to upload the actual file.
        </div>
      )}

      {/* Phone — kept on entry types where a contact number actually
          carries meaning (logins/banks/cards/identity records); absent
          everywhere else. Source of truth is entryTypeHasPhone in
          lib/entry-fields.ts so the edit form + detail card stay in
          lockstep. Never pre-filled — the field means "merchant /
          card-issuer customer-service line for THIS entry", not the
          household's personal number, which previously leaked from
          the selected person's profile into every new login. */}
      {entryTypeHasPhone(type) && (
        <PhoneField
          key={`phone-${personKey}-${recurring ? 'rec' : 'std'}`}
          name="phone"
          defaultValue=""
        />
      )}

      {/* Notes always available */}
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          {type === 'note' ? 'Content' : 'Notes'}
        </label>
        <textarea
          name="noteContent"
          rows={4}
          className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition resize-none`}
          placeholder="Any additional notes..."
        />
      </div>

      {/* Options */}
      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
          <input type="checkbox" name="isFavorite" value="true" className={`rounded border-stone-600 bg-stone-800 ${theme.check}`} />
          Favorite
        </label>
        <label className={`flex items-center gap-2 text-sm ${theme.subtleText} cursor-pointer`}>
          <input
            type="checkbox"
            name="isRecurring"
            value="true"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className={`rounded border-stone-600 bg-stone-800 ${theme.check}`}
          />
          Recurring bill
        </label>
        <label className="flex items-center gap-2 text-sm text-amber-400 cursor-pointer">
          <input type="checkbox" name="isPersonal" value="true" defaultChecked={defaultIsPersonal} className="rounded border-stone-600 bg-stone-800 text-amber-600 focus:ring-amber-600" />
          Personal (only you)
        </label>
        {isSuperuser && (
          <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
            <input type="checkbox" name="isPrivate" value="true" defaultChecked={defaultIsPrivate} className={`rounded border-stone-600 bg-stone-800 ${theme.check}`} />
            Private (superuser only)
          </label>
        )}
        {(type === 'login' || type === 'app_login') && (
          <label
            className="flex items-center gap-2 text-sm text-sky-300 cursor-pointer"
            title="When the browser extension lands on this exact site, fill the password automatically — no click needed. Only the browser extension respects this flag."
          >
            <input
              type="checkbox"
              name="autofillOnLoad"
              value="true"
              className="rounded border-stone-600 bg-stone-800 text-sky-600 focus:ring-sky-600"
            />
            Auto-fill on load
          </label>
        )}
      </div>

      {recurring && (
        <SubscriptionFields
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

      {/* Submit */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          onClick={() => setSaveAndNew(false)}
          className={`flex-1 py-2.5 px-4 ${theme.button} disabled:cursor-not-allowed text-white font-medium rounded-lg transition`}
        >
          {loading && !saveAndNew ? 'Saving...' : 'Save Entry'}
        </button>
        <button
          type="submit"
          disabled={loading}
          onClick={() => setSaveAndNew(true)}
          className="py-2.5 px-4 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 font-medium rounded-lg transition text-sm"
        >
          {loading && saveAndNew ? 'Saving...' : 'Save & New'}
        </button>
      </div>
    </form>
    </FormThemeContext.Provider>
  )
}

// ─── Field components ─────────────────────────────────────────────────────────

function PersonPicker({
  profiles,
  value,
  onChange,
}: {
  profiles: FamilyProfile[]
  value: string
  onChange: (value: string) => void
}) {
  const theme = useTheme()
  if (profiles.length === 0) return null
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">Person</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-stone-500">
        Uses this profile to prefill known fields. You can still edit anything.
      </p>
    </div>
  )
}
function Field({
  label,
  name,
  type = 'text',
  placeholder,
  required,
  defaultValue,
  inputMode,
  autoTitleCase,
}: {
  label: string
  name: string
  type?: string
  placeholder?: string
  required?: boolean
  defaultValue?: string
  /** Hint to mobile browsers about which keyboard to show. */
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url'
  /** Title-case the input value when the field loses focus. */
  autoTitleCase?: boolean
}) {
  const theme = useTheme()
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        inputMode={inputMode}
        autoCapitalize={autoTitleCase ? 'words' : undefined}
        onBlur={autoTitleCase ? (e) => { e.currentTarget.value = titleCaseWords(e.currentTarget.value) } : undefined}
        className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
      />
    </div>
  )
}

// Controlled input that applies a formatter on every keystroke
function MaskedField({
  label,
  name,
  placeholder,
  maxLength,
  formatter,
  defaultValue,
  inputMode = 'numeric',
}: {
  label: string
  name: string
  placeholder?: string
  maxLength?: number
  formatter: (v: string) => string
  defaultValue?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'url'
}) {
  const theme = useTheme()
  // Initialize via formatter so any pre-filled value (e.g. from a card scan)
  // shows up with proper grouping/dashes immediately.
  const [value, setValue] = useState(() => (defaultValue ? formatter(defaultValue) : ''))
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type="text"
        name={name}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => setValue(formatter(e.target.value))}
        className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
      />
    </div>
  )
}

// Today as YYYY-MM-DD in the user's LOCAL timezone — used to default
// the Asset "Valued As Of" field. Stays in local time on purpose so a
// user in Atlanta picking "today" sees the same calendar day they'd
// scribble on paper, not yesterday in UTC.
function todayYYYYMMDD(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Native date picker. `<input type="date">` gives us a calendar UI on
// every modern browser/mobile keyboard with zero JS dependency. The
// stored value is YYYY-MM-DD; the server parser accepts both that and
// the legacy MM/DD/YYYY MaskedField output, so no migration needed.
function DatePickerField({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue?: string
}) {
  const theme = useTheme()
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type="date"
        name={name}
        defaultValue={defaultValue}
        className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
      />
    </div>
  )
}

// Currency input with a static "$" prefix glyph. Server-side already
// strips $/, before parsing, so the raw input value can stay just digits
// (or a decimal). Used by the Asset block — Current Value / Purchase
// Value — to make the field visually obvious as money.
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
  const theme = useTheme()
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
          className={`w-full pl-7 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
        />
      </div>
    </div>
  )
}

// Combo input: first tap/click opens dropdown without keyboard,
// second tap/click enables free typing (keyboard appears).
function ComboField({
  label,
  name,
  options,
  placeholder,
  defaultValue,
  onChange,
}: {
  label: string
  name: string
  options: string[]
  placeholder?: string
  defaultValue?: string
  /** Called every time the value changes (typed or selected). Used by
   *  the Asset Kind field so the parent can conditionally render the
   *  vehicular fields when the kind matches Car/Truck/etc. */
  onChange?: (value: string) => void
}) {
  const theme = useTheme()
  const [value, setValueState] = useState(defaultValue ?? '')
  const setValue = (v: string) => {
    setValueState(v)
    onChange?.(v)
  }
  const [open, setOpen] = useState(false)
  // typing=false → readOnly (no keyboard), typing=true → editable
  const [typing, setTyping] = useState(false)

  const filtered = options.filter((o) =>
    value === '' || o.toLowerCase().includes(value.toLowerCase())
  )

  function handleClick() {
    if (!open) {
      // First tap: open dropdown, keep readOnly (no keyboard)
      setOpen(true)
      setTyping(false)
    } else if (!typing) {
      // Second tap: enable keyboard
      setTyping(true)
    }
  }

  function handleSelect(opt: string) {
    setValue(opt)
    setOpen(false)
    setTyping(false)
  }

  function handleBlur() {
    setTimeout(() => {
      setOpen(false)
      setTyping(false)
    }, 150)
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
        onBlur={handleBlur}
        className={`w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition cursor-pointer`}
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
          {typing && (
            <div className="px-3 py-1.5 text-xs text-stone-600 bg-stone-900/50">
              or keep typing to enter custom value
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// URL field: auto-prefixes https://www. on first focus, open-link button when populated
function UrlField({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const theme = useTheme()
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
          className={`flex-1 px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 ${theme.inputFocus} transition`}
        />
        {hasUrl && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            tabIndex={-1}
            className={`px-3 py-2.5 bg-stone-700 hover:bg-stone-600 border border-stone-600 rounded-lg text-stone-300 ${theme.hoverText} transition flex items-center shrink-0`}
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>
    </div>
  )
}

// ─── Smart category-suggestion pill ─────────────────────────────────────────
//
// Reads the title + URL from the surrounding form (uncontrolled inputs,
// queried via FormData on demand) and asks Claude for the best category +
// subcategory. Click "Use this" to apply.

function CategorySuggestionPill({
  type,
  categories,
  subcategories,
  onAccept,
}: {
  type: string
  categories: Category[]
  subcategories: Subcategory[]
  onAccept: (categoryId: string, subcategoryId: string | null) => void
}) {
  const theme = useTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<{
    categoryId: string
    categoryName: string
    subcategoryId: string | null
    subcategoryName: string | null
  } | null>(null)

  async function suggest() {
    setError(null)
    setSuggestion(null)
    // Find the form element + read its title + url fields.
    const form = document.querySelector('form')
    if (!form) {
      setError('No form found.')
      return
    }
    const fd = new FormData(form)
    const title = (fd.get('title') as string ?? '').trim()
    const url = (fd.get('url') as string ?? '').trim()
    if (title.length < 2) {
      setError('Type a title first.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url, type }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      if (!data.categorySlug) {
        setError(`Couldn't find a category match (confidence: ${data.confidence}).`)
        return
      }
      const cat = categories.find((c) => c.slug === data.categorySlug)
      if (!cat) {
        setError(`Suggested category "${data.categorySlug}" not in your list.`)
        return
      }
      const sub = data.subcategoryName
        ? subcategories.find((s) => s.categoryId === cat.id && s.name === data.subcategoryName)
        : null
      setSuggestion({
        categoryId: cat.id,
        categoryName: cat.name,
        subcategoryId: sub?.id ?? null,
        subcategoryName: sub?.name ?? null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="-mt-1 mb-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={suggest}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ${theme.pillIdle} disabled:opacity-50 border rounded-full transition`}
        >
          {busy ? (
            <>
              <span className={`w-2.5 h-2.5 border ${theme.spinnerBorder} border-t-transparent rounded-full animate-spin`} />
              Thinking…
            </>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/cobb/icons/brands/claude2.png" width={14} height={14} alt="" className="object-contain shrink-0" />
              Suggest category
            </>
          )}
        </button>
        {suggestion && (
          <button
            type="button"
            onClick={() => onAccept(suggestion.categoryId, suggestion.subcategoryId)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium ${theme.pillFilled} text-white rounded-full transition`}
          >
            Use: {suggestion.categoryName}
            {suggestion.subcategoryName && <span className="opacity-80">› {suggestion.subcategoryName}</span>}
          </button>
        )}
        {error && <span className="text-[11px] text-amber-400">{error}</span>}
      </div>
    </div>
  )
}
