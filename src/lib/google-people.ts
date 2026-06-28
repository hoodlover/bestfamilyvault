// Thin wrapper around Google's People API + the OAuth token refresh
// dance. Every public function takes a userId and internally:
//   1. Reads gmail_link to get the user's tokens
//   2. Refreshes the access_token if it's expired (POST to /token)
//   3. Calls the People API as that user
//
// Errors throw with a short string the caller can translate. Network
// hiccups and HTTP 4xx bodies are NOT swallowed — sync engine surfaces
// them as { error } from server actions.

import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { gmailLinks, type gmailContacts } from '@/lib/db/schema'

const PERSON_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'addresses',
  'organizations',
  'birthdays',
  'biographies',
  'metadata',
].join(',')

const PEOPLE_BASE = 'https://people.googleapis.com/v1'

// ─── Token management ───────────────────────────────────────────────────────

interface RefreshedTokens {
  access_token: string
  expires_in: number
  scope?: string
  token_type: string
}

/**
 * Reads the user's gmail_link row, refreshes the access token if expired
 * (or expiring within 60 s), and returns a usable bearer + the gmail
 * email for logging context. Throws if the user hasn't linked Gmail.
 */
export async function getGoogleAccessToken(userId: string): Promise<{ accessToken: string; gmailEmail: string }> {
  const link = await db
    .select()
    .from(gmailLinks)
    .where(eq(gmailLinks.userId, userId))
    .then((r) => r[0])
  if (!link) throw new Error('Gmail not linked.')

  const stillValid = link.accessTokenExpiresAt
    ? link.accessTokenExpiresAt.getTime() - Date.now() > 60_000
    : false
  if (stillValid) {
    return { accessToken: link.accessToken, gmailEmail: link.gmailEmail }
  }

  // Refresh.
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth env vars missing.')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: link.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token refresh failed: ${res.status} ${text}`)
  }
  const tokens = (await res.json()) as RefreshedTokens

  await db
    .update(gmailLinks)
    .set({
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope ?? link.scope,
      updatedAt: new Date(),
    })
    .where(eq(gmailLinks.userId, userId))

  return { accessToken: tokens.access_token, gmailEmail: link.gmailEmail }
}

// ─── People API → local shape mapping ───────────────────────────────────────

type ContactInsertable = typeof gmailContacts.$inferInsert

// Compose a 3-line address from People API structured fields when the
// API didn't synthesize a formattedValue itself, OR re-format an existing
// formattedValue so it always lands in the canonical:
//
//   123 Main St
//   Atlanta, GA 30301
//   USA
//
// shape that the user expects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAddressValue(a: any): string {
  // Build from structured fields when present — preferred because it's
  // unambiguous and gives us reliable line breaks.
  const street = [a.poBox, a.streetAddress, a.extendedAddress]
    .filter((s) => typeof s === 'string' && s.trim() !== '')
    .map((s: string) => s.trim())
    .join(' ')
  const city = (a.city ?? '').trim()
  const region = (a.region ?? '').trim()
  const postal = (a.postalCode ?? '').trim()
  const country = (a.country ?? '').trim()
  if (street || city || region || postal || country) {
    const lines: string[] = []
    if (street) lines.push(street)
    const cityLine = [city, [region, postal].filter(Boolean).join(' ').trim()]
      .filter(Boolean)
      .join(', ')
    if (cityLine) lines.push(cityLine)
    if (country) lines.push(country)
    return lines.join('\n')
  }
  // No structured fields available — fall back to formattedValue and
  // normalize whatever shape it's in (single-line, comma-delimited, etc.).
  if (typeof a.formattedValue === 'string') return normalizeAddressString(a.formattedValue)
  return ''
}

/**
 * Best-effort normalizer for an address string that came in mashed onto
 * one line. Handles the most common US patterns: "Street, City, State
 * Zip[, Country]" → 3 clean lines. Already-multiline strings are left
 * alone (just trims and collapses blank lines).
 */
export function normalizeAddressString(raw: string): string {
  if (!raw) return raw
  const cleanRaw = raw.replace(/ /g, ' ').trim()
  if (!cleanRaw) return cleanRaw

  if (/\r?\n/.test(cleanRaw)) {
    return cleanRaw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .join('\n')
  }

  const parts = cleanRaw.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return cleanRaw

  // Country = a trailing alpha-only part (no digits). Pop it if present
  // and there's enough of an address left.
  let country: string | undefined
  if (parts.length >= 3 && !/\d/.test(parts[parts.length - 1])) {
    country = parts.pop()
  }

  let cityLine: string
  let street: string

  // Last remaining part SHOULD be "STATE ZIP" — e.g. "GA 30301".
  const stateZipRe = /^([A-Za-z][A-Za-z .]*)\s+(\d{5}(?:-\d{4})?)$/
  const stateZipMatch = parts[parts.length - 1].match(stateZipRe)
  if (stateZipMatch && parts.length >= 3) {
    const stateZip = parts.pop()!
    const city = parts.pop()!
    cityLine = `${city}, ${stateZip}`
    street = parts.join(', ')
  } else {
    // Fallback: assume the second-to-last and last parts together are the
    // city line.
    if (parts.length >= 2) {
      const last = parts.pop()!
      const cityCandidate = parts.pop()!
      cityLine = `${cityCandidate}, ${last}`
      street = parts.join(', ')
    } else {
      return cleanRaw
    }
  }

  const lines: string[] = []
  if (street) lines.push(street)
  if (cityLine) lines.push(cityLine)
  if (country) lines.push(country)
  return lines.join('\n')
}

/**
 * Dedupe a multi-value field (emails, phones) by a canonical comparison
 * key. Keeps the FIRST occurrence's display string, so users see what
 * they entered (formatting and all). Used both at import-time and inside
 * normalizeMyContacts for cleanup of existing rows.
 */
export function dedupeByKey<T extends { value: string }>(
  arr: T[],
  keyFn: (v: T) => string,
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of arr) {
    const k = keyFn(item)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

const emailKey = (e: { value: string }) => e.value.trim().toLowerCase()
const phoneKey = (p: { value: string }) => p.value.replace(/\D/g, '')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGoogleToLocal(person: any, userId: string): Omit<ContactInsertable, 'id' | 'createdAt' | 'updatedAt'> {
  const primaryName = person.names?.[0] ?? {}
  const orgs = person.organizations?.[0] ?? {}
  const bio = person.biographies?.[0]?.value ?? null
  const bd = person.birthdays?.[0]?.date
  const birthday = bd
    ? `${bd.year ? String(bd.year).padStart(4, '0') + '-' : ''}${String(bd.month ?? 0).padStart(2, '0')}-${String(bd.day ?? 0).padStart(2, '0')}`.replace(/^-/, '')
    : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawEmails = (person.emailAddresses ?? []).map((e: any) => ({
    value: (e.value as string) ?? '',
    ...(e.type ? { type: e.type as string } : {}),
  })).filter((e: { value?: string }) => !!e.value)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPhones = (person.phoneNumbers ?? []).map((p: any) => ({
    value: (p.value as string) ?? '',
    ...(p.type ? { type: p.type as string } : {}),
  })).filter((p: { value?: string }) => !!p.value)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawAddresses = (person.addresses ?? []).map((a: any) => ({
    value: buildAddressValue(a),
    ...(a.type ? { type: a.type as string } : {}),
  })).filter((a: { value?: string }) => !!a.value)

  return {
    userId,
    googleResourceName: person.resourceName ?? null,
    googleEtag: person.etag ?? null,
    displayName: primaryName.displayName ?? null,
    givenName: primaryName.givenName ?? null,
    familyName: primaryName.familyName ?? null,
    // Dedupe at import time so duplicates from Gmail don't even land in
    // our DB. Email comparison is case-insensitive; phone comparison is
    // digits-only.
    emails: dedupeByKey(rawEmails, emailKey),
    phones: dedupeByKey(rawPhones, phoneKey),
    addresses: rawAddresses,
    organization: orgs.name ?? null,
    jobTitle: orgs.title ?? null,
    birthday,
    notes: bio,
    syncStatus: 'synced',
    deletedAt: null,
  }
}

interface LocalContactShape {
  displayName: string | null
  givenName: string | null
  familyName: string | null
  emails: Array<{ value: string; type?: string | null }> | null
  phones: Array<{ value: string; type?: string | null }> | null
  addresses: Array<{ value: string; type?: string | null }> | null
  organization: string | null
  jobTitle: string | null
  birthday: string | null
  notes: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLocalToGoogle(local: LocalContactShape): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {}
  if (local.givenName || local.familyName || local.displayName) {
    out.names = [{
      givenName: local.givenName ?? undefined,
      familyName: local.familyName ?? undefined,
      // displayName is computed by Google from given+family; only set
      // if we have one and no parts.
      ...(!local.givenName && !local.familyName && local.displayName
        ? { unstructuredName: local.displayName }
        : {}),
    }]
  }
  if (local.emails && local.emails.length > 0) {
    out.emailAddresses = local.emails.map((e) => ({ value: e.value, type: e.type ?? undefined }))
  }
  if (local.phones && local.phones.length > 0) {
    out.phoneNumbers = local.phones.map((p) => ({ value: p.value, type: p.type ?? undefined }))
  }
  if (local.addresses && local.addresses.length > 0) {
    out.addresses = local.addresses.map((a) => ({ formattedValue: a.value, type: a.type ?? undefined }))
  }
  if (local.organization || local.jobTitle) {
    out.organizations = [{ name: local.organization ?? undefined, title: local.jobTitle ?? undefined }]
  }
  if (local.birthday) {
    // 'YYYY-MM-DD' or 'MM-DD'
    const parts = local.birthday.split('-').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n))
    if (parts.length === 3) out.birthdays = [{ date: { year: parts[0], month: parts[1], day: parts[2] } }]
    else if (parts.length === 2) out.birthdays = [{ date: { month: parts[0], day: parts[1] } }]
  }
  if (local.notes) out.biographies = [{ value: local.notes, contentType: 'TEXT_PLAIN' }]
  return out
}

// Field mask listing what we send/care about — Google rejects updates
// without an explicit mask of which fields to overwrite.
const UPDATE_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'addresses',
  'organizations',
  'birthdays',
  'biographies',
].join(',')

// ─── Public API ─────────────────────────────────────────────────────────────

interface FetchResult {
  contacts: ReturnType<typeof mapGoogleToLocal>[]
  deletedResourceNames: string[]
  nextSyncToken: string | null
  expiredSyncToken: boolean
}

/**
 * Pull contact changes for a user. If syncToken is provided, fetches only
 * adds/edits/deletes since the last sync. If null, full fetch and ask
 * Google for a new syncToken at the end. If Google reports the token is
 * expired, we return expiredSyncToken=true so the caller can fall back
 * to a full fetch.
 */
export async function fetchContactsPage(
  userId: string,
  opts: { syncToken?: string | null; pageToken?: string | null },
): Promise<FetchResult & { nextPageToken: string | null }> {
  const { accessToken } = await getGoogleAccessToken(userId)

  const params = new URLSearchParams({
    personFields: PERSON_FIELDS,
    pageSize: '500', // Max allowed
  })
  if (opts.syncToken) {
    params.set('syncToken', opts.syncToken)
    params.set('requestSyncToken', 'true')
  } else {
    params.set('requestSyncToken', 'true')
  }
  if (opts.pageToken) params.set('pageToken', opts.pageToken)

  const res = await fetch(`${PEOPLE_BASE}/people/me/connections?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (res.status === 410) {
    // EXPIRED_SYNC_TOKEN — caller falls back to full fetch.
    return {
      contacts: [],
      deletedResourceNames: [],
      nextSyncToken: null,
      nextPageToken: null,
      expiredSyncToken: true,
    }
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`People API list failed: ${res.status} ${text}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any
  const connections = data.connections ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts: ReturnType<typeof mapGoogleToLocal>[] = []
  const deletedResourceNames: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of connections as any[]) {
    if (p.metadata?.deleted === true) {
      if (p.resourceName) deletedResourceNames.push(p.resourceName)
    } else {
      contacts.push(mapGoogleToLocal(p, userId))
    }
  }
  return {
    contacts,
    deletedResourceNames,
    nextSyncToken: data.nextSyncToken ?? null,
    nextPageToken: data.nextPageToken ?? null,
    expiredSyncToken: false,
  }
}

/**
 * Push a vault-created contact to Gmail. Returns the new resourceName +
 * etag so the caller can persist them on the row.
 */
export async function createPersonOnGoogle(
  userId: string,
  local: LocalContactShape,
): Promise<{ resourceName: string; etag: string }> {
  const { accessToken } = await getGoogleAccessToken(userId)
  const body = mapLocalToGoogle(local)
  const res = await fetch(`${PEOPLE_BASE}/people:createContact`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`People API create failed: ${res.status} ${text}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any
  return { resourceName: data.resourceName, etag: data.etag }
}

/**
 * Push a vault-edited contact to Gmail. Requires the etag we cached on
 * the last fetch — Google returns 409 if we send a stale one, which the
 * caller treats as "remote won, re-pull this contact".
 */
export async function updatePersonOnGoogle(
  userId: string,
  resourceName: string,
  etag: string,
  local: LocalContactShape,
): Promise<{ etag: string }> {
  const { accessToken } = await getGoogleAccessToken(userId)
  // Strip the leading 'people/' to build the URL — Google's update endpoint
  // takes the bare resource name.
  const body = { ...mapLocalToGoogle(local), etag }
  const params = new URLSearchParams({ updatePersonFields: UPDATE_FIELDS })
  const res = await fetch(`${PEOPLE_BASE}/${resourceName}:updateContact?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`People API update failed: ${res.status} ${text}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any
  return { etag: data.etag }
}

export async function deletePersonOnGoogle(userId: string, resourceName: string): Promise<void> {
  const { accessToken } = await getGoogleAccessToken(userId)
  const res = await fetch(`${PEOPLE_BASE}/${resourceName}:deleteContact`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // 404 on delete = already gone, treat as success.
  if (!res.ok && res.status !== 404) {
    const text = await res.text()
    throw new Error(`People API delete failed: ${res.status} ${text}`)
  }
}
