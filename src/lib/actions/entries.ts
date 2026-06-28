'use server'

import { eq, and, or, ilike, asc, desc, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, categories, subcategories, files, entryFavorites, noteFavorites, gmailContacts, balanceHistory } from '@/lib/db/schema'
import { encrypt, decrypt, decryptEntries } from '@/lib/crypto'
import { titleCaseWords } from '@/lib/title-case'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

// Asset thumbnail picker — point at one of the entry's existing image
// attachments and (optionally) save a pan/zoom crop alongside it.
// Stored in customFields so we don't need a schema change. Passing
// fileId='' clears the selection. Verifies the file actually belongs
// to the entry so a request can't pin a thumbnail to someone else's
// image. Crop is stored as object-position percentages + a CSS scale
// — render-only, no canvas re-encode, so the user can re-adjust later
// without quality loss.
export async function setAssetThumbnail(
  entryId: string,
  fileId: string,
  crop?: { offsetX?: number; offsetY?: number; scale?: number },
) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (entry.type !== 'asset') return { error: 'Thumbnails only apply to asset entries.' }

  let nextCustom: Record<string, string> | null = { ...(entry.customFields ?? {}) }

  if (fileId) {
    const owned = await db
      .select({ id: files.id, contentType: files.contentType })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.entryId, entryId)))
      .then((r) => r[0])
    if (!owned) return { error: 'Pick a file attached to this entry.' }
    if (!owned.contentType.startsWith('image/')) return { error: 'Thumbnail must be an image attachment.' }
    nextCustom.thumbnailFileId = fileId
    // Crop params are optional — fall back to centered + 1.0 scale if
    // the caller didn't pass any (e.g. a fresh pick before the user
    // adjusts). Clamp into sane ranges to keep the render stable.
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
    if (crop) {
      if (typeof crop.offsetX === 'number') nextCustom.thumbnailOffsetX = String(clamp(crop.offsetX, 0, 100))
      if (typeof crop.offsetY === 'number') nextCustom.thumbnailOffsetY = String(clamp(crop.offsetY, 0, 100))
      if (typeof crop.scale === 'number') nextCustom.thumbnailScale = String(clamp(crop.scale, 1, 6))
    }
  } else {
    delete nextCustom.thumbnailFileId
    delete nextCustom.thumbnailOffsetX
    delete nextCustom.thumbnailOffsetY
    delete nextCustom.thumbnailScale
  }

  if (Object.keys(nextCustom).length === 0) nextCustom = null

  await db
    .update(entries)
    .set({ customFields: nextCustom, updatedAt: new Date(), updatedBy: session.user.id })
    .where(eq(entries.id, entryId))

  revalidatePath(`/entries/${entryId}`)
  return { success: true as const }
}

// Advance a recurring entry's subscriptionRenewsAt by one period — used by
// the calendar's "Mark handled" button on overdue rows so a paid bill
// rolls forward without the user having to open the entry and re-pick a
// date. Returns the new YYYY-MM-DD on success.
//
// Period semantics:
//   - 'monthly' → +1 month, clamping to the last day of the target month
//     so e.g. Jan 31 → Feb 28/29 rather than rolling to Mar 3.
//   - 'yearly'  → +1 year, same day-of-month (leap-day Feb 29 → Feb 28
//     in non-leap years, courtesy of the same clamp).
//   - 'one_time' → no-op error (one-shots don't have a "next" period).
//
// Renewal dates store as YYYY-MM-DD text on the entries row to dodge
// timezone surprises (see schema.ts:398-400 for the rationale).
export async function advanceEntryRenewal(entryId: string): Promise<
  { success: true; nextRenewsAt: string } | { error: string }
> {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const row = await db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .then((r) => r[0])
  if (!row) return { error: 'Entry not found.' }
  if (!canAccess(row, session.user.id, session.user.role)) {
    return { error: 'Not yours.' }
  }
  if (!row.isRecurring) return { error: 'Not a recurring entry.' }
  if (!row.subscriptionRenewsAt) return { error: 'No renewal date set.' }

  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(row.subscriptionRenewsAt.trim())
  if (!m) return { error: 'Renewal date is in an unexpected format.' }
  const curY = parseInt(m[1])
  const curM = parseInt(m[2]) - 1
  const curD = parseInt(m[3])

  const period = row.subscriptionPeriod ?? 'monthly'
  let nextY = curY
  let nextM = curM
  let nextD = curD
  if (period === 'yearly') {
    nextY += 1
  } else if (period === 'one_time') {
    return { error: 'One-time bills can\'t roll forward — edit or delete instead.' }
  } else {
    // Default monthly.
    nextM += 1
    if (nextM > 11) { nextM = 0; nextY += 1 }
  }
  // Clamp day to the last day of the target month (handles Jan 31 → Feb).
  const lastDayOfTarget = new Date(nextY, nextM + 1, 0).getDate()
  if (nextD > lastDayOfTarget) nextD = lastDayOfTarget

  const yyyy = String(nextY).padStart(4, '0')
  const mm = String(nextM + 1).padStart(2, '0')
  const dd = String(nextD).padStart(2, '0')
  const nextRenewsAt = `${yyyy}-${mm}-${dd}`

  await db
    .update(entries)
    .set({ subscriptionRenewsAt: nextRenewsAt, updatedAt: new Date() })
    .where(eq(entries.id, entryId))

  revalidatePath('/calendar')
  revalidatePath('/subscriptions')
  revalidatePath(`/entries/${entryId}`)
  return { success: true, nextRenewsAt }
}

// True when the caller is allowed to mutate or read this entry/note.
// - isPrivate: the Private Vault. Superuser-only (Lance + Heather).
// - isPersonal: the user's own corner. STRICTLY owner-only — superusers
//   do NOT bypass. The kids are adults; their personal items belong to
//   them and only them. If Lance needs to recover something for a kid
//   later, that's a manual DB job, not a routine UI flow.
function canAccess(
  row: { isPrivate: boolean; isPersonal: boolean; createdBy: string },
  userId: string,
  role: string
) {
  const isSuperuser = role === 'superuser'
  if (row.isPrivate && !isSuperuser) return false
  if (row.isPersonal && row.createdBy !== userId) return false
  return true
}

// Pick out arbitrary key/value extras from the form into the customFields
// JSON column. Today there's just one — `paidWith` from the subscription
// flow — but as more lightweight per-entry attributes get added, they go
// here too instead of polluting the entries schema with one column each.
function extractCustomFields(formData: FormData): Record<string, string> | null {
  const out: Record<string, string> = {}
  const paidWith = (formData.get('paidWith') as string | null)?.trim()
  if (paidWith) out.paidWith = paidWith
  // Free-text companion to paidWith — used when the funding source is a
  // website (PayPal, the registrar's own billing page, etc.) rather than
  // a credit card in the vault. Rendered as a clickable link wherever
  // paidWith is surfaced. Stored alongside paidWith, not instead of, so
  // a subscription can be "Visa 7030 via paypal.com" if that ever fits.
  const paidWithUrl = (formData.get('paidWithUrl') as string | null)?.trim()
  if (paidWithUrl) out.paidWithUrl = paidWithUrl
  // Asset basis fields: purchase value (dollars on the wire → cents
  // stored as a number string) + purchase date (MM/DD/YYYY text). Both
  // live in customFields so we don't bloat the entries table with
  // asset-only columns.
  const purchaseValueDollars = (formData.get('purchaseValueDollars') as string | null)?.trim() ?? ''
  if (purchaseValueDollars) {
    const cents = Math.round(Number(purchaseValueDollars.replace(/[$,]/g, '')) * 100)
    if (Number.isFinite(cents)) out.purchaseValueCents = String(cents)
  }
  const purchaseDate = (formData.get('purchaseDate') as string | null)?.trim() ?? ''
  if (purchaseDate) out.purchaseDate = purchaseDate
  // Vehicular asset fields (v259) — VIN, license plate, driver link,
  // insurance acct #, registration expiry. The driver link is the key
  // that the Family Info popout uses to surface "Heather's car expires
  // May 2027" under her row, so the userId stored here MUST match a
  // real users.id (front-end populates from the family-profiles list).
  const VEH_KEYS = ['vin', 'licensePlate', 'driverUserId', 'insuranceAccountNumber', 'registrationExpiry'] as const
  for (const key of VEH_KEYS) {
    const v = (formData.get(key) as string | null)?.trim()
    if (v) out[key] = v
  }
  // Mileage log (v273) — stringified JSON array of {date, miles} from
  // VehicularFieldsBlock's hidden input. We re-encode here after a
  // defensive parse so a tampered/broken payload can't pollute storage.
  // Empty list → omit so the key doesn't sit on disk as "[]".
  const mileageRaw = formData.get('mileageHistory') as string | null
  const cleanMileage = sanitizeMileageHistory(mileageRaw)
  if (cleanMileage) out.mileageHistory = cleanMileage
  return Object.keys(out).length > 0 ? out : null
}

// Re-validate the mileageHistory payload coming off the form. Same shape
// the client component writes, but we don't trust the client. Returns
// the re-stringified JSON, or null if the payload was empty / invalid.
function sanitizeMileageHistory(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const out: { date: string; miles: number }[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const date = typeof item.date === 'string' ? item.date.trim() : ''
      const miles = Number(item.miles)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (!Number.isFinite(miles) || miles < 0) continue
      out.push({ date, miles: Math.round(miles) })
    }
    return out.length > 0 ? JSON.stringify(out) : null
  } catch {
    return null
  }
}

// Parse a calendar date from either "MM/DD/YYYY" (legacy MaskedField
// output) or "YYYY-MM-DD" (HTML5 <input type="date"> output) into a
// Date at noon UTC. Noon UTC avoids the TZ-drift problem that bare
// `new Date("04/07/2026")` causes for users west of UTC (which would
// otherwise stamp the prior calendar day). Returns null on anything
// that can't be unambiguously read.
function parseMMDDYYYY(raw: string): Date | null {
  let mm: number, dd: number, yyyy: number
  // ISO YYYY-MM-DD — what <input type="date"> hands back.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    yyyy = Number(iso[1]); mm = Number(iso[2]); dd = Number(iso[3])
  } else {
    // US MM/DD/YYYY — kept so saved entries from the auto-slash era
    // continue to round-trip through updateEntry.
    const parts = raw.split('/')
    if (parts.length !== 3) return null
    mm = Number(parts[0]); dd = Number(parts[1]); yyyy = Number(parts[2])
  }
  if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy)) return null
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1900) return null
  return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0))
}

// Merge into existing customFields for updates so we don't clobber keys the
// edit form didn't render (e.g. an older entry might have a key from a
// future feature — leave it alone). Empty/cleared values are removed so
// the UI doesn't keep showing a stale "Paid with" link.
function mergeCustomFields(
  existing: Record<string, string> | null | undefined,
  formData: FormData,
): Record<string, string> | null {
  const merged: Record<string, string> = { ...(existing ?? {}) }
  // Only touch keys this form actually owns.
  if (formData.has('paidWith')) {
    const v = (formData.get('paidWith') as string | null)?.trim()
    if (v) merged.paidWith = v
    else delete merged.paidWith
  }
  if (formData.has('paidWithUrl')) {
    const v = (formData.get('paidWithUrl') as string | null)?.trim()
    if (v) merged.paidWithUrl = v
    else delete merged.paidWithUrl
  }
  if (formData.has('purchaseValueDollars')) {
    const raw = (formData.get('purchaseValueDollars') as string | null)?.trim() ?? ''
    if (raw) {
      const cents = Math.round(Number(raw.replace(/[$,]/g, '')) * 100)
      if (Number.isFinite(cents)) merged.purchaseValueCents = String(cents)
      else delete merged.purchaseValueCents
    } else {
      delete merged.purchaseValueCents
    }
  }
  if (formData.has('purchaseDate')) {
    const v = (formData.get('purchaseDate') as string | null)?.trim()
    if (v) merged.purchaseDate = v
    else delete merged.purchaseDate
  }
  // Vehicular asset fields (v259) — same delete-when-cleared pattern as
  // the basis fields above so the user can blank out a misentered VIN
  // or unset the driver link by clearing the input and saving.
  const VEH_KEYS = ['vin', 'licensePlate', 'driverUserId', 'insuranceAccountNumber', 'registrationExpiry'] as const
  for (const key of VEH_KEYS) {
    if (!formData.has(key)) continue
    const v = (formData.get(key) as string | null)?.trim()
    if (v) merged[key] = v
    else delete merged[key]
  }
  // Mileage log (v273) — same delete-when-empty pattern. The hidden
  // input is always present on the form (the block emits it even when
  // the list is empty), so formData.has('mileageHistory') is true for
  // any vehicular edit. An empty array sanitizes to null → unset the
  // key so a vehicle that had readings can have them all removed.
  if (formData.has('mileageHistory')) {
    const cleanMileage = sanitizeMileageHistory(formData.get('mileageHistory') as string | null)
    if (cleanMileage) merged.mileageHistory = cleanMileage
    else delete merged.mileageHistory
  }
  return Object.keys(merged).length > 0 ? merged : null
}

// ─── Entries ──────────────────────────────────────────────────────────────────

export async function createEntry(formData: FormData) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const isPrivate = formData.get('isPrivate') === 'true'
  if (isPrivate && session.user.role !== 'superuser') {
    return { error: 'Only superusers can create private entries.' }
  }

  const categoryId = formData.get('categoryId') as string

  // Superusers can create a subcategory inline from the add-entry form: a
  // non-empty newSubcategoryName means "make this subcategory under the
  // chosen category and file the entry in it." Ignored for non-superusers.
  let subcategoryId = (formData.get('subcategoryId') as string) || null
  const newSubName = ((formData.get('newSubcategoryName') as string) ?? '').trim()
  if (newSubName && session.user.role === 'superuser') {
    const slug = newSubName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const [sub] = await db
      .insert(subcategories)
      .values({ categoryId, name: newSubName, slug, sortOrder: 9999 })
      .returning()
    subcategoryId = sub.id
  }

  // Stamp passwordUpdatedAt only if this insert actually carries a
  // password — keeps the column meaningful (NULL for non-login entries,
  // a real date for anything we just captured).
  const passwordValue = (formData.get('password') as string) || null

  // Asset-type entries arrive with a manual "Current Value" + "As Of"
  // pair. Convert to the same currentBalance (signed cents) + balanceAsOf
  // shape bank_account uses, so getNetWorth() picks them up without any
  // type-specific branching.
  const entryType = formData.get('type') as string
  const assetValueDollars = (formData.get('assetValueDollars') as string) ?? ''
  const assetValueAsOf = (formData.get('assetValueAsOf') as string) ?? ''
  const parsedAssetCents =
    entryType === 'asset' && assetValueDollars.trim()
      ? Math.round(Number(assetValueDollars.replace(/[$,]/g, '')) * 100)
      : null
  // assetValueAsOf comes in as MM/DD/YYYY from the auto-slash MaskedField.
  // parseMMDDYYYY produces a noon-UTC Date so the calendar day round-trips
  // cleanly regardless of the user's timezone. Falls back to today if the
  // user typed a value but no date.
  const parsedAssetAsOf =
    entryType === 'asset' && assetValueAsOf.trim()
      ? parseMMDDYYYY(assetValueAsOf)
      : entryType === 'asset' && parsedAssetCents != null
      ? new Date()
      : null
  const assetCurrentBalance =
    parsedAssetCents != null && Number.isFinite(parsedAssetCents) ? parsedAssetCents : null
  const assetBalanceAsOf =
    parsedAssetAsOf && !isNaN(parsedAssetAsOf.getTime()) ? parsedAssetAsOf : null

  const [entry] = await db
    .insert(entries)
    .values({
      currentBalance: assetCurrentBalance,
      balanceAsOf: assetBalanceAsOf,
      categoryId,
      subcategoryId,
      llcSubcategoryId: (formData.get('llcSubcategoryId') as string) || null,
      type: formData.get('type') as 'login' | 'note' | 'document' | 'bank_account' | 'credit_card' | 'identity' | 'asset',
      title: titleCaseWords(formData.get('title')),
      username: (formData.get('username') as string) || null,
      password: encrypt(passwordValue),
      passwordUpdatedAt: passwordValue ? new Date() : null,
      url: (formData.get('url') as string) || null,
      noteContent: encrypt((formData.get('noteContent') as string) || null),
      bankName: (formData.get('bankName') as string) || null,
      accountType: (formData.get('accountType') as string) || null,
      accountNumber: encrypt((formData.get('accountNumber') as string) || null),
      routingNumber: encrypt((formData.get('routingNumber') as string) || null),
      cardholderName: (formData.get('cardholderName') as string) || null,
      cardNumber: encrypt((formData.get('cardNumber') as string) || null),
      expiryDate: (formData.get('expiryDate') as string) || null,
      cvv: encrypt((formData.get('cvv') as string) || null),
      cardNetwork: (formData.get('cardNetwork') as string) || null,
      firstName: (formData.get('firstName') as string) || null,
      lastName: (formData.get('lastName') as string) || null,
      dateOfBirth: (formData.get('dateOfBirth') as string) || null,
      ssn: encrypt((formData.get('ssn') as string) || null),
      passport: encrypt((formData.get('passport') as string) || null),
      driversLicense: encrypt((formData.get('driversLicense') as string) || null),
      phone: (formData.get('phone') as string) || null,
      customFields: extractCustomFields(formData),
      // isFavorite is now per-user — handled via entryFavorites below.
      isFavorite: false,
      autofillOnLoad: formData.get('autofillOnLoad') === 'true',
      isRecurring: formData.get('isRecurring') === 'true',
      ...readSubscriptionFields(formData),
      isPrivate,
      isPersonal: formData.get('isPersonal') === 'true',
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  if (formData.get('isFavorite') === 'true') {
    await db.insert(entryFavorites).values({ userId: session.user.id, entryId: entry.id })
  }

  // Asset appraisal: record this initial value as the first snapshot so
  // 30-day deltas + history charts have a baseline to walk forward from.
  if (entryType === 'asset' && assetCurrentBalance != null && assetBalanceAsOf) {
    await db.insert(balanceHistory).values({
      entryId: entry.id,
      balanceCents: assetCurrentBalance,
      periodEnd: assetBalanceAsOf,
    })
  }

  revalidatePath('/dashboard')
  revalidatePath(`/categories/${categoryId}`)
  revalidatePath('/my-vault')
  revalidatePath('/subscriptions')
  return { success: true, id: entry.id }
}

// Helper: pull subscription detail off the form. Empty values become null
// so we don't store '' on a date column. Amount cents arrives as a string
// from the hidden mirror in <SubscriptionFields>; we parse defensively.
function readSubscriptionFields(formData: FormData) {
  const recurring = formData.get('isRecurring') === 'true'
  if (!recurring) {
    return {
      subscriptionAmountCents: null,
      subscriptionPeriod: null,
      subscriptionStartedAt: null,
      subscriptionRenewsAt: null,
    }
  }
  const amountRaw = ((formData.get('subscriptionAmountCents') as string) ?? '').trim()
  const amount = amountRaw ? Number(amountRaw) : null
  const period = ((formData.get('subscriptionPeriod') as string) ?? '').trim() || null
  const startedAt = ((formData.get('subscriptionStartedAt') as string) ?? '').trim() || null
  const renewsAt = ((formData.get('subscriptionRenewsAt') as string) ?? '').trim() || null
  return {
    subscriptionAmountCents: amount != null && Number.isFinite(amount) ? Math.round(amount) : null,
    subscriptionPeriod: period,
    subscriptionStartedAt: startedAt,
    subscriptionRenewsAt: renewsAt,
  }
}

export async function updateEntry(id: string, formData: FormData) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (!canAccess(entry, session.user.id, session.user.role)) return { error: 'Access denied.' }

  // passwordUpdatedAt: only bump when the password field actually
  // changes. Compare plaintext-in vs decrypted-existing — comparing
  // ciphertexts can't work because the cipher is non-deterministic
  // (different IV per encrypt).
  const incomingPassword = (formData.get('password') as string) || null
  const previousPasswordPlain = decrypt(entry.password)
  const passwordChanged = incomingPassword !== previousPasswordPlain

  // Type change is opt-in via a "type" field in the form. We only
  // accept enum values we know about — anything else stays at the
  // existing type (don't corrupt the DB just because someone built a
  // weird payload). Switching types is non-destructive: every column
  // exists on every row regardless of type, so a former login that
  // becomes a note keeps password/url in the DB silently — they just
  // stop being rendered. Lance can clear them deliberately before
  // switching if he wants.
  const incomingType = formData.get('type') as string | null
  const allowedTypes: ReadonlySet<typeof entry.type> = new Set([
    'login', 'note', 'document', 'bank_account', 'credit_card', 'identity', 'asset',
  ])
  const nextType = incomingType && allowedTypes.has(incomingType as typeof entry.type)
    ? (incomingType as typeof entry.type)
    : entry.type

  // Asset appraisal update: if the form carried a new value, treat it as
  // a fresh snapshot — bump currentBalance and append to balance_history.
  // If the form omitted the field (other entry types, or a no-op edit on
  // an asset), preserve whatever's already there.
  const incomingAssetValue = ((formData.get('assetValueDollars') as string) ?? '').trim()
  const incomingAssetAsOf = ((formData.get('assetValueAsOf') as string) ?? '').trim()
  let nextCurrentBalance = entry.currentBalance
  let nextBalanceAsOf = entry.balanceAsOf
  let appraisalSnapshot: { cents: number; periodEnd: Date } | null = null
  if (nextType === 'asset' && incomingAssetValue) {
    const parsedCents = Math.round(Number(incomingAssetValue.replace(/[$,]/g, '')) * 100)
    if (Number.isFinite(parsedCents)) {
      // MM/DD/YYYY → noon UTC; matches the parsing done at create time.
      const parsedDate = incomingAssetAsOf ? parseMMDDYYYY(incomingAssetAsOf) : null
      const validDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : new Date()
      if (parsedCents !== entry.currentBalance) {
        appraisalSnapshot = { cents: parsedCents, periodEnd: validDate }
      }
      nextCurrentBalance = parsedCents
      nextBalanceAsOf = validDate
    }
  }

  await db
    .update(entries)
    .set({
      type: nextType,
      currentBalance: nextCurrentBalance,
      balanceAsOf: nextBalanceAsOf,
      categoryId: formData.get('categoryId') as string,
      subcategoryId: (formData.get('subcategoryId') as string) || null,
      llcSubcategoryId: (formData.get('llcSubcategoryId') as string) || null,
      title: titleCaseWords(formData.get('title')),
      username: (formData.get('username') as string) || null,
      password: encrypt(incomingPassword),
      passwordUpdatedAt: passwordChanged
        ? incomingPassword
          ? new Date()
          : null
        : entry.passwordUpdatedAt,
      url: (formData.get('url') as string) || null,
      noteContent: encrypt((formData.get('noteContent') as string) || null),
      bankName: (formData.get('bankName') as string) || null,
      accountType: (formData.get('accountType') as string) || null,
      accountNumber: encrypt((formData.get('accountNumber') as string) || null),
      routingNumber: encrypt((formData.get('routingNumber') as string) || null),
      cardholderName: (formData.get('cardholderName') as string) || null,
      cardNumber: encrypt((formData.get('cardNumber') as string) || null),
      expiryDate: (formData.get('expiryDate') as string) || null,
      cvv: encrypt((formData.get('cvv') as string) || null),
      cardNetwork: (formData.get('cardNetwork') as string) || null,
      firstName: (formData.get('firstName') as string) || null,
      lastName: (formData.get('lastName') as string) || null,
      dateOfBirth: (formData.get('dateOfBirth') as string) || null,
      ssn: encrypt((formData.get('ssn') as string) || null),
      passport: encrypt((formData.get('passport') as string) || null),
      driversLicense: encrypt((formData.get('driversLicense') as string) || null),
      phone: (formData.get('phone') as string) || null,
      customFields: mergeCustomFields(entry.customFields, formData),
      // isFavorite is now per-user — synced via entryFavorites below.
      autofillOnLoad: formData.get('autofillOnLoad') === 'true',
      isRecurring: formData.get('isRecurring') === 'true',
      ...readSubscriptionFields(formData),
      isPersonal: formData.get('isPersonal') === 'true',
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(entries.id, id))

  // Sync the current user's favorite for this entry. Other users' favorites
  // (if any) are untouched — favorites are per-user.
  const wantsFavorite = formData.get('isFavorite') === 'true'
  const existingFav = await db
    .select({ id: entryFavorites.id })
    .from(entryFavorites)
    .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, id)))
    .then((r) => r[0])
  if (wantsFavorite && !existingFav) {
    await db.insert(entryFavorites).values({ userId: session.user.id, entryId: id })
  } else if (!wantsFavorite && existingFav) {
    await db.delete(entryFavorites).where(eq(entryFavorites.id, existingFav.id))
  }

  if (appraisalSnapshot) {
    await db.insert(balanceHistory).values({
      entryId: id,
      balanceCents: appraisalSnapshot.cents,
      periodEnd: appraisalSnapshot.periodEnd,
    })
  }

  revalidatePath('/dashboard')
  revalidatePath(`/categories/${entry.categoryId}`)
  revalidatePath('/my-vault')
  revalidatePath('/subscriptions')
  return { success: true }
}

export async function deleteEntry(id: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (!canAccess(entry, session.user.id, session.user.role)) return { error: 'Access denied.' }

  // Un-parent any children first
  await db.update(entries).set({ parentEntryId: null }).where(eq(entries.parentEntryId, id))
  await db.delete(entries).where(eq(entries.id, id))

  const category = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, entry.categoryId)).then((r) => r[0])
  revalidatePath('/dashboard')
  if (category) revalidatePath(`/categories/${category.slug}`)
  revalidatePath('/vault')
  revalidatePath('/my-vault')
  return { success: true }
}

export async function bulkMoveEntries(ids: string[], targetCategoryId: string, targetSubcategoryId: string | null) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }
  if (ids.length === 0) return { error: 'No entries selected.' }

  const cat = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, targetCategoryId))
    .then((r) => r[0])
  if (!cat) return { error: 'Target category not found.' }

  // Filter to only the entries this caller is allowed to move. Without this,
  // a regular member could move someone else's private/personal entries by
  // submitting their ids.
  const rows = await db
    .select({ id: entries.id, isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
    .from(entries)
    .where(inArray(entries.id, ids))
  const allowed = rows
    .filter((r) => canAccess(r, session.user.id, session.user.role))
    .map((r) => r.id)
  if (allowed.length === 0) return { error: 'Nothing to move.' }

  const BATCH = 50
  for (let i = 0; i < allowed.length; i += BATCH) {
    await db
      .update(entries)
      .set({ categoryId: targetCategoryId, subcategoryId: targetSubcategoryId, updatedAt: new Date() })
      .where(inArray(entries.id, allowed.slice(i, i + BATCH)))
  }

  revalidatePath('/dashboard', 'layout')
  revalidatePath(`/categories/${cat.slug}`)
  return { success: true, moved: allowed.length, skipped: ids.length - allowed.length }
}

// ─── Grouped entries ──────────────────────────────────────────────────────────

export async function mergeEntries(ids: string[], masterId?: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }
  if (ids.length < 2) return { error: 'Select at least 2 entries to merge.' }

  // Pull full rows (decrypted) so we can union the fields onto the master.
  const fullRows = await db.select().from(entries).where(inArray(entries.id, ids))
  if (fullRows.length !== ids.length) return { error: 'Entry not found.' }
  for (const r of fullRows) {
    if (!canAccess(r, session.user.id, session.user.role)) return { error: 'Access denied.' }
  }

  const decrypted = decryptEntries(fullRows)

  // Caller can pick which entry is the master (parent). Default: first id.
  const parentId = masterId && ids.includes(masterId) ? masterId : ids[0]
  const childIds = ids.filter((id) => id !== parentId)
  const parent = decrypted.find((r) => r.id === parentId)!
  const children = decrypted.filter((r) => r.id !== parentId)

  // ─── Field-merge logic ──────────────────────────────────────────────────
  //
  // For each value-bearing field on the parent:
  //   - If parent's value is empty, fill from the first non-empty child.
  //   - If parent already has a value AND a child has a different value,
  //     append the alternate to the noteContent as a labeled remark
  //     ("Alt password (from 'Old Gmail'): xxxxx"). Same-value duplicates
  //     are silently merged, no remark.
  //
  // Treats every meaningful field — login fields, bank fields, card
  // fields, identity fields, phone, customFields. Doesn't touch
  // category/subcategory/title/type/isPrivate/etc.

  type FieldKey =
    | 'username' | 'password' | 'url'
    | 'bankName' | 'accountType' | 'accountNumber' | 'routingNumber'
    | 'cardholderName' | 'cardNumber' | 'expiryDate' | 'cvv' | 'cardNetwork'
    | 'firstName' | 'lastName' | 'dateOfBirth' | 'ssn' | 'passport' | 'driversLicense'
    | 'phone'

  const FIELD_LABELS: Record<FieldKey, string> = {
    username: 'username',
    password: 'password',
    url: 'URL',
    bankName: 'bank name',
    accountType: 'account type',
    accountNumber: 'account number',
    routingNumber: 'routing number',
    cardholderName: 'cardholder',
    cardNumber: 'card number',
    expiryDate: 'expiry',
    cvv: 'CVV',
    cardNetwork: 'network',
    firstName: 'first name',
    lastName: 'last name',
    dateOfBirth: 'DOB',
    ssn: 'SSN',
    passport: 'passport',
    driversLicense: 'driver license',
    phone: 'phone',
  }

  const FIELDS: FieldKey[] = [
    'username', 'password', 'url',
    'bankName', 'accountType', 'accountNumber', 'routingNumber',
    'cardholderName', 'cardNumber', 'expiryDate', 'cvv', 'cardNetwork',
    'firstName', 'lastName', 'dateOfBirth', 'ssn', 'passport', 'driversLicense',
    'phone',
  ]

  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const merged: Record<string, string | null> = {}
  const remarks: string[] = []

  for (const key of FIELDS) {
    // Build seen-value list across parent + all children.
    const slots: Array<{ source: string; value: string }> = []
    const parentVal = norm((parent as Record<string, unknown>)[key])
    if (parentVal) slots.push({ source: parent.title || 'Master', value: parentVal })
    for (const c of children) {
      const cv = norm((c as Record<string, unknown>)[key])
      if (cv) slots.push({ source: c.title || 'Merged child', value: cv })
    }

    if (slots.length === 0) continue

    // Pick the first slot's value as canonical. Anything else that's
    // *different* (case-sensitive comparison after trim) becomes a remark.
    const chosen = slots[0].value
    merged[key] = chosen

    const seen = new Set<string>([chosen])
    for (let i = 1; i < slots.length; i++) {
      const slot = slots[i]
      if (seen.has(slot.value)) continue
      seen.add(slot.value)
      remarks.push(`Alt ${FIELD_LABELS[key]} (from "${slot.source}"): ${slot.value}`)
    }
  }

  // Note content: union the existing note text from each entry, separated
  // by a divider. Plus the alt-field remarks built above.
  const existingNotes: string[] = []
  if (parent.noteContent && parent.noteContent.trim()) existingNotes.push(parent.noteContent.trim())
  for (const c of children) {
    if (c.noteContent && c.noteContent.trim()) {
      existingNotes.push(`— from "${c.title || 'merged'}":\n${c.noteContent.trim()}`)
    }
  }
  const noteParts: string[] = []
  if (existingNotes.length > 0) noteParts.push(existingNotes.join('\n\n'))
  if (remarks.length > 0) {
    noteParts.push(`Merged ${new Date().toISOString().slice(0, 10)} from ${ids.length} entries:\n${remarks.map((r) => `• ${r}`).join('\n')}`)
  }
  const mergedNote = noteParts.join('\n\n— — —\n\n').trim()

  // Custom fields: union, parent's keys win on conflict (but child-only
  // keys get added).
  const mergedCustom: Record<string, string> = {}
  for (const c of children) {
    if (c.customFields && typeof c.customFields === 'object') {
      for (const [k, v] of Object.entries(c.customFields as Record<string, string>)) {
        if (typeof v === 'string' && v.trim()) mergedCustom[k] = v
      }
    }
  }
  if (parent.customFields && typeof parent.customFields === 'object') {
    for (const [k, v] of Object.entries(parent.customFields as Record<string, string>)) {
      if (typeof v === 'string' && v.trim()) mergedCustom[k] = v
    }
  }
  const customFieldsResult = Object.keys(mergedCustom).length > 0 ? mergedCustom : null

  // Encrypt the merged values for the encrypted fields before writing back.
  const updatePayload: Record<string, unknown> = {
    username: merged.username ?? parent.username,
    password: encrypt(merged.password ?? parent.password ?? null),
    url: merged.url ?? parent.url,
    bankName: merged.bankName ?? parent.bankName,
    accountType: merged.accountType ?? parent.accountType,
    accountNumber: encrypt(merged.accountNumber ?? parent.accountNumber ?? null),
    routingNumber: encrypt(merged.routingNumber ?? parent.routingNumber ?? null),
    cardholderName: merged.cardholderName ?? parent.cardholderName,
    cardNumber: encrypt(merged.cardNumber ?? parent.cardNumber ?? null),
    expiryDate: merged.expiryDate ?? parent.expiryDate,
    cvv: encrypt(merged.cvv ?? parent.cvv ?? null),
    cardNetwork: merged.cardNetwork ?? parent.cardNetwork,
    firstName: merged.firstName ?? parent.firstName,
    lastName: merged.lastName ?? parent.lastName,
    dateOfBirth: merged.dateOfBirth ?? parent.dateOfBirth,
    ssn: encrypt(merged.ssn ?? parent.ssn ?? null),
    passport: encrypt(merged.passport ?? parent.passport ?? null),
    driversLicense: encrypt(merged.driversLicense ?? parent.driversLicense ?? null),
    phone: merged.phone ?? parent.phone,
    customFields: customFieldsResult,
    noteContent: encrypt(mergedNote === '' ? null : mergedNote),
    // CRITICAL: the new parent must NOT carry a parentEntryId of its own.
    // The "Master" / promote button in LinkedCredentials re-runs this
    // action with masterId = childId — if we left parentEntryId untouched
    // here, the new parent would still point at the OLD parent (the row
    // it was promoted out of), and the immediately-below child update
    // would set the OLD parent's parentEntryId = new parent. Result: a
    // two-row redirect cycle (each entry points at the other), the entry
    // detail page bounces to the old master, and the "survivor" Lance
    // picked literally never appears on screen.
    parentEntryId: null,
    updatedAt: new Date(),
    updatedBy: session.user.id,
  }

  await db.update(entries).set(updatePayload).where(eq(entries.id, parentId))

  // Children: keep them grouped under the parent (existing parent-link
  // behavior preserved — the user can still drill into the originals).
  // We also collect EVERY descendant of every child — v289 only walked
  // direct children, but a child that was itself a master before this
  // merge has its own children pointing at it. Lance hit this when
  // merging four logins that had earlier been merged in pairs: 6 of 11
  // files stayed stranded on the grand-children. BFS from the direct
  // children captures the whole tree.
  const allMergedChildIds: string[] = [...childIds]
  {
    let frontier: string[] = [...childIds]
    while (frontier.length > 0) {
      const next = await db
        .select({ id: entries.id })
        .from(entries)
        .where(inArray(entries.parentEntryId, frontier))
      if (next.length === 0) break
      const ids = next.map((c) => c.id)
      allMergedChildIds.push(...ids)
      frontier = ids
    }
  }

  await db
    .update(entries)
    .set({ parentEntryId: parentId, updatedAt: new Date() })
    .where(inArray(entries.id, allMergedChildIds))

  // Move every file off each child / grandchild onto the parent. The
  // master becomes a true accumulator: open the merged login and every
  // attachment from every pre-merge row is right there.
  let movedFileCount = 0
  if (allMergedChildIds.length > 0) {
    const moved = await db
      .update(files)
      .set({ entryId: parentId })
      .where(inArray(files.entryId, allMergedChildIds))
      .returning({ id: files.id })
    movedFileCount = moved.length
  }

  // Revalidate the merge-candidates page itself or the merged group sticks
  // around in the listing until the user navigates away — its RSC payload
  // would otherwise serve from cache. Same reason for /search (the merge
  // tool there hits this action too).
  revalidatePath('/dashboard', 'layout')
  revalidatePath('/admin/merge-candidates')
  revalidatePath('/search')
  revalidatePath(`/entries/${parentId}`)
  return { success: true, parentId, alternateRemarksAdded: remarks.length, movedFileCount }
}

export async function removeFromGroup(childId: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const child = await db.select().from(entries).where(eq(entries.id, childId)).then((r) => r[0])
  if (!child) return { error: 'Entry not found.' }
  if (!canAccess(child, session.user.id, session.user.role)) return { error: 'Access denied.' }

  await db.update(entries).set({ parentEntryId: null, updatedAt: new Date() }).where(eq(entries.id, childId))
  revalidatePath('/dashboard', 'layout')
  return { success: true }
}

export async function addCredentialToGroup(parentId: string, username: string, password: string, note?: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const parent = await db.select().from(entries).where(eq(entries.id, parentId)).then((r) => r[0])
  if (!parent) return { error: 'Parent entry not found.' }
  if (!canAccess(parent, session.user.id, session.user.role)) return { error: 'Access denied.' }

  await db.insert(entries).values({
    categoryId: parent.categoryId,
    subcategoryId: parent.subcategoryId,
    type: 'login',
    title: parent.title,
    url: parent.url,
    username: username || null,
    password: encrypt(password || null),
    passwordUpdatedAt: password ? new Date() : null,
    noteContent: encrypt(note || null),
    parentEntryId: parentId,
    isFavorite: false,
    isPrivate: parent.isPrivate,
    isPersonal: parent.isPersonal,
    createdBy: session.user.id,
    updatedBy: session.user.id,
  })

  revalidatePath('/dashboard', 'layout')
  return { success: true }
}

// Inline edit for a credential inside a merged group. Lets you tweak title,
// url, username, password, notes on a child without leaving the master's
// detail page. Master entries can also be edited via the main edit form;
// this action works on either since it's keyed only by id.
export async function updateLinkedCredential(
  id: string,
  fields: {
    title?: string
    url?: string | null
    username?: string | null
    password?: string | null
    noteContent?: string | null
  }
) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (!canAccess(entry, session.user.id, session.user.role)) return { error: 'Access denied.' }

  const update: Record<string, unknown> = {
    updatedBy: session.user.id,
    updatedAt: new Date(),
  }
  if (fields.title !== undefined) update.title = titleCaseWords(fields.title) || entry.title
  if (fields.url !== undefined) update.url = fields.url || null
  if (fields.username !== undefined) update.username = fields.username || null
  if (fields.password !== undefined) {
    const incoming = fields.password || null
    const prev = decrypt(entry.password)
    if (incoming !== prev) {
      update.password = encrypt(incoming)
      update.passwordUpdatedAt = incoming ? new Date() : null
    }
  }
  if (fields.noteContent !== undefined) update.noteContent = encrypt(fields.noteContent || null)

  await db.update(entries).set(update).where(eq(entries.id, id))

  revalidatePath('/dashboard', 'layout')
  return { success: true }
}

// Toggle the recurring-bill flag on an entry. Surfaces the entry on the
// /subscriptions page without moving it out of its original category, so
// a Netflix login can stay under Entertainment AND show up in the
// recurring-bills list at the same time. Removing it there just flips the
// flag — the entry stays put.
export async function setEntryRecurring(id: string, recurring: boolean) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (!canAccess(entry, session.user.id, session.user.role)) return { error: 'Access denied.' }

  await db.update(entries).set({ isRecurring: recurring }).where(eq(entries.id, id))
  revalidatePath('/subscriptions')
  revalidatePath('/dashboard')
  if (entry.categoryId) {
    const category = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, entry.categoryId)).then((r) => r[0])
    if (category) revalidatePath(`/categories/${category.slug}`)
  }
  return { success: true }
}

// Legacy entry-favorite toggle — kept for back-compat callers. Favorites
// are now per-user; this delegates to the entryFavorites join table for
// the current session user. The `current` param is ignored — server
// reads its own state — but kept on the signature so we don't break
// existing callers that pass it.
export async function toggleFavorite(id: string, _current?: boolean) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const entry = await db.select().from(entries).where(eq(entries.id, id)).then((r) => r[0])
  if (!entry) return { error: 'Entry not found.' }
  if (!canAccess(entry, session.user.id, session.user.role)) return { error: 'Access denied.' }

  const existing = await db
    .select({ id: entryFavorites.id })
    .from(entryFavorites)
    .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, id)))
    .then((r) => r[0])
  if (existing) {
    await db.delete(entryFavorites).where(eq(entryFavorites.id, existing.id))
  } else {
    await db.insert(entryFavorites).values({ userId: session.user.id, entryId: id })
  }
  revalidatePath('/dashboard')
  revalidatePath('/my-vault')
  return { success: true }
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function createNote(formData: FormData) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const isPrivate = formData.get('isPrivate') === 'true'
  if (isPrivate && session.user.role !== 'superuser') {
    return { error: 'Only superusers can create private notes.' }
  }

  const rawContent = (formData.get('content') as string) || ''
  const [note] = await db
    .insert(notes)
    .values({
      categoryId: (formData.get('categoryId') as string) || null,
      subcategoryId: (formData.get('subcategoryId') as string) || null,
      title: titleCaseWords(formData.get('title')),
      // notes.content is NOT NULL with default '' — store empty string when no
      // input, encrypted ciphertext otherwise.
      content: rawContent === '' ? '' : (encrypt(rawContent) ?? ''),
      // isFavorite is now per-user — handled via noteFavorites below.
      isFavorite: false,
      isPrivate,
      isPersonal: formData.get('isPersonal') === 'true',
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  if (formData.get('isFavorite') === 'true') {
    await db.insert(noteFavorites).values({ userId: session.user.id, noteId: note.id })
  }

  revalidatePath('/dashboard')
  revalidatePath('/notes')
  revalidatePath('/my-vault')
  return { success: true, id: note.id }
}

export async function updateNote(id: string, formData: FormData) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const note = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!note) return { error: 'Note not found.' }
  if (!canAccess(note, session.user.id, session.user.role)) return { error: 'Access denied.' }

  // Recipe subcategory tags — if the form sent any `tags` fields they
  // are subcategory IDs. Resolve to names, save as notes.tags[], and
  // set the primary subcategoryId to the first selected so existing
  // single-subcategory navigation still finds the recipe. The form
  // submits this even on non-recipe notes (it's just empty there).
  const rawTagIds = formData.getAll('tags').map((v) => String(v).trim()).filter(Boolean)
  let tagNames: string[] = []
  let primarySubcategoryId: string | null | undefined = undefined
  if (rawTagIds.length > 0 && note.categoryId) {
    const subs = await db
      .select({ id: subcategories.id, name: subcategories.name })
      .from(subcategories)
      .where(and(eq(subcategories.categoryId, note.categoryId), inArray(subcategories.id, rawTagIds)))
    const byId = new Map(subs.map((s) => [s.id, s]))
    const ordered = rawTagIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
    tagNames = ordered.map((s) => s.name)
    primarySubcategoryId = ordered[0]?.id ?? null
  } else if (formData.has('tags')) {
    // Form was submitted with an empty tag set — user cleared all
    // subcategories. Clear stored tags + subcategoryId too.
    tagNames = []
    primarySubcategoryId = null
  }

  const rawContent = (formData.get('content') as string) || ''
  await db
    .update(notes)
    .set({
      title: titleCaseWords(formData.get('title')),
      content: rawContent === '' ? '' : (encrypt(rawContent) ?? ''),
      categoryId: (formData.get('categoryId') as string) || null,
      isPersonal: formData.get('isPersonal') === 'true',
      ...(primarySubcategoryId !== undefined ? { subcategoryId: primarySubcategoryId } : {}),
      ...(formData.has('tags') ? { tags: tagNames.length > 0 ? tagNames : null } : {}),
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))

  // Sync the current user's favorite for this note.
  const wantsFavorite = formData.get('isFavorite') === 'true'
  const existingFav = await db
    .select({ id: noteFavorites.id })
    .from(noteFavorites)
    .where(and(eq(noteFavorites.userId, session.user.id), eq(noteFavorites.noteId, id)))
    .then((r) => r[0])
  if (wantsFavorite && !existingFav) {
    await db.insert(noteFavorites).values({ userId: session.user.id, noteId: id })
  } else if (!wantsFavorite && existingFav) {
    await db.delete(noteFavorites).where(eq(noteFavorites.id, existingFav.id))
  }

  revalidatePath('/dashboard')
  revalidatePath('/notes')
  revalidatePath('/my-vault')
  return { success: true }
}

// ─── Locate ("Where Is It") — thin actions used by the accordion UI ─────────
//
// The /locate page is a flat document of inline rows. Each row is a
// notes row under the `where-is-it` category with the subcategory =
// area. The generic createNote/updateNote/deleteNote work fine but
// they expect FormData and pull a lot of extra context (tags, favorite
// toggle, isPersonal etc.) — wrappers below take the three values the
// inline editor actually cares about and leave everything else alone.

const WHERE_IS_IT_SLUG = 'where-is-it'

async function getWhereIsItCategoryId(): Promise<string | null> {
  const row = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, WHERE_IS_IT_SLUG))
    .then((r) => r[0])
  return row?.id ?? null
}

export async function createLocateNote(input: { areaId: string; title: string; content: string }) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const title = input.title.trim()
  if (!title) return { error: 'Title is required.' }

  const categoryId = await getWhereIsItCategoryId()
  if (!categoryId) return { error: 'Category not seeded. Run scripts/seed-where-is-it.ts.' }

  // Sanity check the area belongs to this category — stops a request
  // from pinning a row into someone else's subcategory tree.
  const owned = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.id, input.areaId), eq(subcategories.categoryId, categoryId)))
    .then((r) => r[0])
  if (!owned) return { error: 'Pick a real area.' }

  const content = input.content
  const [row] = await db
    .insert(notes)
    .values({
      categoryId,
      subcategoryId: input.areaId,
      title: titleCaseWords(title),
      content: content === '' ? '' : (encrypt(content) ?? ''),
      isFavorite: false,
      isPersonal: false,
      isPrivate: false,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning({ id: notes.id })

  revalidatePath('/locate')
  return { success: true as const, id: row.id }
}

export async function updateLocateNote(id: string, input: { title: string; content: string }) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const note = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!note) return { error: 'Note not found.' }
  if (!canAccess(note, session.user.id, session.user.role)) return { error: 'Access denied.' }

  const title = input.title.trim()
  if (!title) return { error: 'Title is required.' }
  const content = input.content

  await db
    .update(notes)
    .set({
      title: titleCaseWords(title),
      content: content === '' ? '' : (encrypt(content) ?? ''),
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, id))

  revalidatePath('/locate')
  return { success: true as const }
}

export async function deleteLocateNote(id: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const note = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!note) return { error: 'Note not found.' }
  if (!canAccess(note, session.user.id, session.user.role)) return { error: 'Access denied.' }

  await db.delete(notes).where(eq(notes.id, id))
  revalidatePath('/locate')
  return { success: true as const }
}

// Per-row visibility toggle — flips isPrivate on a Where Is It row so
// the superuser can hide individual items (e.g. handgun in safe) from
// family members without an all-or-nothing global mode. Superuser-only:
// non-superusers can't see private rows anyway, and giving them the
// toggle would let a kid hide a row from everyone else by accident.
export async function setLocateNotePrivate(id: string, isPrivate: boolean) {
  const session = await getSession()
  if (session.user.role !== 'superuser') return { error: 'Superuser only.' }

  const note = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!note) return { error: 'Note not found.' }

  await db
    .update(notes)
    .set({ isPrivate, updatedBy: session.user.id, updatedAt: new Date() })
    .where(eq(notes.id, id))

  revalidatePath('/locate')
  return { success: true as const }
}

// Inline "+ New area" action — creates a subcategory under the
// where-is-it category. Idempotent on (categoryId, slug): re-running
// with the same name returns the existing row.
export async function createWhereIsItArea(name: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const trimmed = name.trim()
  if (!trimmed) return { error: 'Name is required.' }

  const categoryId = await getWhereIsItCategoryId()
  if (!categoryId) return { error: 'Category not seeded. Run scripts/seed-where-is-it.ts.' }

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'area'

  const existing = await db
    .select({ id: subcategories.id })
    .from(subcategories)
    .where(and(eq(subcategories.categoryId, categoryId), eq(subcategories.slug, slug)))
    .then((r) => r[0])
  if (existing) {
    revalidatePath('/locate')
    return { success: true as const, id: existing.id, alreadyExisted: true as const }
  }

  // Land the new area after the seeded ones — sortOrder 100+ keeps
  // user-added rooms below the originals without us having to renumber.
  const maxRow = await db
    .select({ max: subcategories.sortOrder })
    .from(subcategories)
    .where(eq(subcategories.categoryId, categoryId))
    .orderBy(desc(subcategories.sortOrder))
    .limit(1)
    .then((r) => r[0])
  const nextSortOrder = Math.max((maxRow?.max ?? 0) + 1, 100)

  const [row] = await db
    .insert(subcategories)
    .values({ categoryId, slug, name: trimmed, sortOrder: nextSortOrder })
    .returning({ id: subcategories.id })

  revalidatePath('/locate')
  return { success: true as const, id: row.id, alreadyExisted: false as const }
}

export async function deleteNote(id: string) {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const note = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!note) return { error: 'Note not found.' }
  if (!canAccess(note, session.user.id, session.user.role)) return { error: 'Access denied.' }

  await db.delete(notes).where(eq(notes.id, id))
  revalidatePath('/dashboard')
  revalidatePath('/notes')
  revalidatePath('/my-vault')
  return { success: true }
}

// ─── Search ───────────────────────────────────────────────────────────────────

// Parses a search box into terms. Quoted spans become exact-order phrases
// ("bank of america" → matches that order), bare words become individual
// AND-terms (each must appear somewhere, any order). Empty input → empty
// array, which causes searchVault to short-circuit to no results.
//
// Examples:
//   `bofa`                          → ['bofa']
//   `bank america`                  → ['bank', 'america']
//   `"bank of america" lance`       → ['bank of america', 'lance']
//   `"john doe"`                    → ['john doe']
function parseSearchTerms(raw: string): string[] {
  const out: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const term = (m[1] ?? m[2] ?? '').trim()
    if (term.length > 0) out.push(term)
  }
  return out
}

// Fetch attachment counts for a list of entry IDs in a single query.
// Used both by the search action (to enrich result entries with a chip)
// and by browse pages (my-vault etc.) that want the same indicator.
// Returns a Map keyed by entryId; entries with zero files just won't
// appear in the map — caller treats undefined as 0.
//
// v295 widening: counts now roll up files from descendants too. Lance
// hit a merged Axos entry whose chip showed 5 attachments because only
// the master's own files were counted, while the v294 self-heal hadn't
// yet run (self-heal fires on detail-view, not search list). Now BFS
// from each requested id, tag every descendant with the root it belongs
// to, then SUM file counts across the descendant tree per root. The
// search chip becomes accurate immediately — even before the entry is
// opened and the heal flattens the data.
export async function getAttachmentCountsByEntry(entryIds: string[]): Promise<Map<string, number>> {
  if (entryIds.length === 0) return new Map()

  // descendant id → ancestor id from the requested set. Starts with each
  // requested root mapping to itself so direct-file rows count.
  const descendantToRoot = new Map<string, string>()
  for (const root of entryIds) descendantToRoot.set(root, root)

  let frontier: string[] = [...entryIds]
  while (frontier.length > 0) {
    const next = await db
      .select({ id: entries.id, parentEntryId: entries.parentEntryId })
      .from(entries)
      .where(inArray(entries.parentEntryId, frontier))
    if (next.length === 0) break
    for (const c of next) {
      if (!c.parentEntryId) continue
      const parentRoot = descendantToRoot.get(c.parentEntryId)
      if (!parentRoot) continue
      if (!descendantToRoot.has(c.id)) descendantToRoot.set(c.id, parentRoot)
    }
    frontier = next.map((c) => c.id)
  }

  const allEntryIds = Array.from(descendantToRoot.keys())
  const rows = await db
    .select({
      entryId: files.entryId,
      count: sql<number>`count(*)::int`,
    })
    .from(files)
    .where(inArray(files.entryId, allEntryIds))
    .groupBy(files.entryId)

  const out = new Map<string, number>()
  for (const r of rows) {
    if (!r.entryId) continue
    const root = descendantToRoot.get(r.entryId)
    if (!root) continue
    out.set(root, (out.get(root) ?? 0) + Number(r.count))
  }
  return out
}

// Same shape as getAttachmentCountsByEntry but for notes. Note cards
// surface a Paperclip chip whenever the underlying note has 1+ files
// attached — same at-a-glance signal entries already have.
export async function getAttachmentCountsByNote(noteIds: string[]): Promise<Map<string, number>> {
  if (noteIds.length === 0) return new Map()
  const rows = await db
    .select({
      noteId: files.noteId,
      count: sql<number>`count(*)::int`,
    })
    .from(files)
    .where(inArray(files.noteId, noteIds))
    .groupBy(files.noteId)
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.noteId) out.set(r.noteId, Number(r.count))
  }
  return out
}

export async function searchVault(query: string, opts?: { hasFilesOnly?: boolean }) {
  const session = await getSession()
  const isSuperuser = session.user.role === 'superuser'
  const userId = session.user.id

  const terms = parseSearchTerms(query)
  if (terms.length === 0) {
    return { entries: [], notes: [], files: [], contacts: [] }
  }

  // Each term/phrase becomes an OR across the searchable fields, then all
  // term-clauses get ANDed together. So `bank america` matches a row where
  // "bank" is in the title and "america" is in the URL — or vice versa.
  // `"bank of america"` matches a row where that exact substring appears in
  // any one searchable field.
  //
  // Entries AND standalone notes are filtered in JS (not SQL) because
  // their searchable bodies (entries.noteContent, notes.content, plus
  // entries.customFields and the various card/account/SSN columns) are
  // all encrypted at rest. ILIKE against ciphertext can't match plaintext
  // queries, so we pull every accessible row, decrypt, and match against
  // a combined blob of plaintext + decrypted fields. Notes-content search
  // is also what makes recipes searchable by ingredient (recipes are just
  // notes filed under the recipes category).
  const fileTermClauses = terms.map((t) => ilike(files.filename, `%${t}%`))
  // Contacts: search displayName / given / family / organization / jobTitle
  // plus the JSON emails + phones blobs (cast to text so ILIKE can grep
  // inside them — covers "lance@gmail.com" matching the emails array).
  // Contacts are per-user, so scope by userId regardless of role.
  const contactTermClauses = terms.map((t) => {
    const wild = `%${t}%`
    return or(
      ilike(gmailContacts.displayName, wild),
      ilike(gmailContacts.givenName, wild),
      ilike(gmailContacts.familyName, wild),
      ilike(gmailContacts.organization, wild),
      ilike(gmailContacts.jobTitle, wild),
      ilike(gmailContacts.notes, wild),
      sql`${gmailContacts.emails}::text ilike ${wild}`,
      sql`${gmailContacts.phones}::text ilike ${wild}`,
    )
  })

  const [candidateEntries, candidateNotes, matchedFiles, matchedContacts] = await Promise.all([
    db
      .select()
      .from(entries)
      .where(
        and(
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          // isPersonal is owner-only — superuser does NOT bypass.
          or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
          isNull(entries.parentEntryId),
        )
      )
      .orderBy(desc(entries.updatedAt)),
    db
      .select()
      .from(notes)
      .where(
        and(
          isSuperuser ? undefined : eq(notes.isPrivate, false),
          or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
        )
      )
      .orderBy(desc(notes.updatedAt)),
    // Files attached to anything (entry / note / category). We filter by the
    // file's own isPrivate flag and then post-filter against parent
    // visibility below — uploads on a private parent inherit isPrivate, but
    // double-check in case of legacy rows.
    db
      .select()
      .from(files)
      .where(
        and(
          isSuperuser ? undefined : eq(files.isPrivate, false),
          ...fileTermClauses
        )
      )
      .orderBy(desc(files.createdAt))
      .limit(20),
    db
      .select({
        id: gmailContacts.id,
        displayName: gmailContacts.displayName,
        givenName: gmailContacts.givenName,
        familyName: gmailContacts.familyName,
        emails: gmailContacts.emails,
        phones: gmailContacts.phones,
        organization: gmailContacts.organization,
        jobTitle: gmailContacts.jobTitle,
      })
      .from(gmailContacts)
      .where(
        and(
          eq(gmailContacts.userId, userId),
          isNull(gmailContacts.deletedAt),
          ...contactTermClauses,
        )
      )
      .orderBy(asc(gmailContacts.displayName))
      .limit(20),
  ])

  // Decrypt every candidate entry and filter in JS so the encrypted fields
  // (noteContent, password, account/card numbers, SSN, passport, license,
  // CVV) also become searchable — that's why someone can find a Salesforce
  // login by typing "sfc" if "sfc" appears anywhere in the notes. Each
  // search term must appear somewhere in the combined blob (AND across
  // terms, OR across fields). Cap raised from 20 → 100: Lance hit the old
  // limit when searching "ionos" with 30+ IONOS-named entries — the older
  // "1&1 IONOS E-Mail login" rows fell off the date-sorted end.
  const decryptedCandidates = decryptEntries(candidateEntries)
  const lowerTerms = terms.map((t) => t.toLowerCase())

  // Two-pass: first filter (every term must appear in the blob), then sort
  // by relevance so title hits surface above body-only hits before the cap.
  // Without this sort, an older entry whose title is the search term gets
  // buried under newer entries that mention the term only in notes.
  function scoreEntry(e: typeof decryptedCandidates[number]): number {
    const title = (e.title ?? '').toLowerCase()
    let score = 0
    for (const t of lowerTerms) {
      if (title === t) score += 1000               // exact title match — top of the heap
      else if (title.startsWith(t)) score += 500   // title prefix
      else if (title.includes(t)) score += 200     // title contains
      // body-only matches stay at score 0 — they still show, just lower
    }
    return score
  }

  const matchedEntries = decryptedCandidates
    .filter((e) => {
      const blob = [
        e.title, e.username, e.url, e.noteContent,
        e.bankName, e.accountType, e.accountNumber, e.routingNumber,
        e.cardholderName, e.cardNumber, e.expiryDate, e.cvv, e.cardNetwork,
        e.firstName, e.lastName, e.dateOfBirth,
        e.ssn, e.passport, e.driversLicense,
        e.phone, e.password,
        e.tags?.join(' ') ?? null,
        e.customFields ? Object.values(e.customFields).join(' ') : null,
      ]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ')
        .toLowerCase()
      return lowerTerms.every((t) => blob.includes(t))
    })
    .sort((a, b) => scoreEntry(b) - scoreEntry(a)) // higher score first; ties keep updatedAt order from candidates
    .slice(0, 100)

  // Same approach for standalone notes — decrypt content, then JS-filter
  // across title + body + tags. Recipe ingredients live in the body too,
  // so this also makes recipes searchable by ingredient.
  const decryptedNotes = candidateNotes.map((n) => ({
    ...n,
    content: n.content === '' ? '' : (decrypt(n.content) ?? ''),
  }))
  // Same title-match relevance boost as entries above. Recipes (which are
  // notes) often match by ingredient in the body — they should still rank
  // below "the recipe whose title contains the term."
  function scoreNote(n: typeof decryptedNotes[number]): number {
    const title = (n.title ?? '').toLowerCase()
    let score = 0
    for (const t of lowerTerms) {
      if (title === t) score += 1000
      else if (title.startsWith(t)) score += 500
      else if (title.includes(t)) score += 200
    }
    return score
  }
  const matchedNotes = decryptedNotes
    .filter((n) => {
      const blob = [n.title, n.content, n.tags?.join(' ') ?? null]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ')
        .toLowerCase()
      return lowerTerms.every((t) => blob.includes(t))
    })
    .sort((a, b) => scoreNote(b) - scoreNote(a))
    .slice(0, 100)

  // Resolve a parent label + link target for each file so the search UI can
  // render "filename → goes to entry/note/category" without N+1 queries on
  // the client.
  const parentEntryIds = matchedFiles.map((f) => f.entryId).filter((x): x is string => !!x)
  const parentNoteIds = matchedFiles.map((f) => f.noteId).filter((x): x is string => !!x)
  const parentCatIds = matchedFiles.map((f) => f.categoryId).filter((x): x is string => !!x)

  const [parentEntries, parentNotes, parentCats] = await Promise.all([
    parentEntryIds.length
      ? db.select({ id: entries.id, title: entries.title, isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
          .from(entries).where(inArray(entries.id, parentEntryIds))
      : Promise.resolve([]),
    parentNoteIds.length
      ? db.select({ id: notes.id, title: notes.title, isPrivate: notes.isPrivate, isPersonal: notes.isPersonal, createdBy: notes.createdBy })
          .from(notes).where(inArray(notes.id, parentNoteIds))
      : Promise.resolve([]),
    parentCatIds.length
      ? db.select({ id: categories.id, name: categories.name, slug: categories.slug })
          .from(categories).where(inArray(categories.id, parentCatIds))
      : Promise.resolve([]),
  ])

  const entryById = new Map(parentEntries.map((e) => [e.id, e]))
  const noteById = new Map(parentNotes.map((n) => [n.id, n]))
  const catById = new Map(parentCats.map((c) => [c.id, c]))

  const fileResults = matchedFiles
    .map((f) => {
      let parentLabel = '—'
      let parentHref: string | null = null
      // parentType drives the small "Note" / "Entry" / "Category" badge
      // on the file row so it's obvious which thing the file is attached
      // to — without it, a filename match shows up as a bare title and
      // the reader has to guess whether tapping opens an entry or a note.
      let parentType: 'entry' | 'note' | 'category' | null = null
      // Skip files whose parent the user can't see (private/personal).
      if (f.entryId) {
        const e = entryById.get(f.entryId)
        if (!e) return null
        if (!canAccess(e, userId, session.user.role)) return null
        parentLabel = e.title
        parentHref = `/entries/${e.id}`
        parentType = 'entry'
      } else if (f.noteId) {
        const n = noteById.get(f.noteId)
        if (!n) return null
        if (!canAccess(n, userId, session.user.role)) return null
        parentLabel = n.title
        parentHref = `/notes/${n.id}`
        parentType = 'note'
      } else if (f.categoryId) {
        const c = catById.get(f.categoryId)
        if (!c) return null
        parentLabel = c.name
        parentHref = `/categories/${c.slug}`
        parentType = 'category'
      }
      return {
        id: f.id,
        filename: f.filename,
        contentType: f.contentType,
        size: f.size,
        parentLabel,
        parentHref,
        parentType,
        downloadHref: `/api/files/${f.id}`,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // Count linked child credentials (parentEntryId) per matched entry so the
  // search row can show a "N logins" pill without opening the card. Only the
  // count is needed here; respect the same visibility rules as the parents.
  const matchedEntryIds = matchedEntries.map((e) => e.id)
  const childRows = matchedEntryIds.length
    ? await db
        .select({
          parentEntryId: entries.parentEntryId,
          isPrivate: entries.isPrivate,
          isPersonal: entries.isPersonal,
          createdBy: entries.createdBy,
        })
        .from(entries)
        .where(inArray(entries.parentEntryId, matchedEntryIds))
    : []
  const childCountByParent = new Map<string, number>()
  for (const c of childRows) {
    if (!c.parentEntryId) continue
    if (!canAccess(c, userId, session.user.role)) continue
    childCountByParent.set(c.parentEntryId, (childCountByParent.get(c.parentEntryId) ?? 0) + 1)
  }

  // Per-entry + per-note file counts — drives both the paperclip chip
  // on the card and (for entries) the optional hasFilesOnly filter
  // below.
  const matchedNoteIds = matchedNotes.map((n) => n.id)
  const [attachmentCounts, noteAttachmentCounts] = await Promise.all([
    getAttachmentCountsByEntry(matchedEntryIds),
    getAttachmentCountsByNote(matchedNoteIds),
  ])

  // hasFilesOnly: when the toggle chip on /search is on, drop any entry
  // that has no attachments. Done AFTER the relevance sort + 100-row cap
  // so the filter respects the same ranking; an entry that's a perfect
  // title match but has no files still gets dropped — that's the point.
  const filteredEntries = opts?.hasFilesOnly
    ? matchedEntries.filter((e) => (attachmentCounts.get(e.id) ?? 0) > 0)
    : matchedEntries

  return {
    entries: filteredEntries.map((e) => {
      const kids = childCountByParent.get(e.id) ?? 0
      const files = attachmentCounts.get(e.id) ?? 0
      // Total credentials bundled here = the parent itself + its children.
      // Undefined when there are no children so the UI renders no pill.
      return {
        ...e,
        linkedCount: kids > 0 ? kids + 1 : undefined,
        attachmentCount: files > 0 ? files : undefined,
      }
    }),
    notes: matchedNotes.map((n) => {
      const files = noteAttachmentCounts.get(n.id) ?? 0
      return {
        ...n,
        attachmentCount: files > 0 ? files : undefined,
      }
    }),
    files: fileResults,
    contacts: matchedContacts.map((c) => {
      const fallbackName = [c.givenName, c.familyName].filter(Boolean).join(' ').trim()
      return {
        id: c.id,
        displayName: c.displayName?.trim() || fallbackName || '(no name)',
        emails: c.emails ?? [],
        phones: c.phones ?? [],
        organization: c.organization,
        jobTitle: c.jobTitle,
      }
    }),
  }
}

// ─── Credential cleanup (superuser only) ────────────────────────────────────
//
// Bulk delete a list of entries by id. Used by /admin/cleanup-credentials
// to blast through chaff after dedupe — each id is independently auth/
// access checked, then deleted in a single batch when all pass. Children
// of a deleted parent are un-parented (matches deleteEntry's behavior),
// so dropping a master without ticking its children just turns them into
// standalone entries.

export async function bulkDeleteCredentials(ids: string[]) {
  const session = await getSession()
  if (session.user.role !== 'superuser') return { error: 'Superuser only.' }
  if (ids.length === 0) return { error: 'Nothing selected.' }
  if (ids.length > 500) return { error: 'Pick fewer than 500 at a time.' }

  // Pull all targeted rows + their access fields. canAccess is
  // re-evaluated even though superuser bypasses most flags — defense
  // against future role changes that might gate this differently.
  const rows = await db
    .select({
      id: entries.id,
      isPrivate: entries.isPrivate,
      isPersonal: entries.isPersonal,
      createdBy: entries.createdBy,
      categoryId: entries.categoryId,
    })
    .from(entries)
    .where(inArray(entries.id, ids))

  const allowed: string[] = []
  for (const r of rows) {
    if (canAccess(r, session.user.id, session.user.role)) allowed.push(r.id)
  }
  if (allowed.length === 0) return { error: 'Nothing deletable.' }

  // Un-parent any kids whose parent is about to die so they survive as
  // standalone rows rather than getting orphaned-and-deleted.
  await db
    .update(entries)
    .set({ parentEntryId: null })
    .where(inArray(entries.parentEntryId, allowed))

  await db.delete(entries).where(inArray(entries.id, allowed))

  revalidatePath('/admin/cleanup-credentials')
  revalidatePath('/dashboard')
  revalidatePath('/vault')
  return { success: true, deleted: allowed.length, skipped: ids.length - allowed.length }
}

// Delete a whole merged-credentials group: the parent + every direct child.
// Used by the "Delete entire group" button on the cleanup page for cases
// where the entire account is dead (e.g. shuttered bank). Children get
// deleted explicitly here — bulkDeleteCredentials would un-parent first,
// which is the wrong behavior when the intent is "kill the whole thing".

export async function deleteCredentialGroup(parentId: string) {
  const session = await getSession()
  if (session.user.role !== 'superuser') return { error: 'Superuser only.' }

  const parent = await db.select().from(entries).where(eq(entries.id, parentId)).then((r) => r[0])
  if (!parent) return { error: 'Group not found.' }
  if (!canAccess(parent, session.user.id, session.user.role)) return { error: 'Access denied.' }

  // Children first so we never leave a dangling parent_entry_id pointing
  // at the about-to-be-deleted parent.
  await db.delete(entries).where(eq(entries.parentEntryId, parentId))
  await db.delete(entries).where(eq(entries.id, parentId))

  revalidatePath('/admin/cleanup-credentials')
  revalidatePath('/dashboard')
  revalidatePath('/vault')
  return { success: true }
}
