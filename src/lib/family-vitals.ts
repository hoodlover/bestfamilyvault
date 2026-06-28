import 'server-only'

// "Family Info" popout backend — resolves the full family roster
// (OWNER + MEMBERS, even if some haven't accepted their invite yet),
// pulls each member's phone / SSN / DOB straight off the users table,
// and finds their existing identity entry by first-name match for the
// deep-link to their "name card with all docs attached."
//
// Stays defensive on the recently-added user columns (phone, ssn,
// dateOfBirth) — pre-migration prod might not have them, so each block
// is its own try/catch and missing fields fall through as null rather
// than 500'ing the dashboard.

import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { users, entries } from './db/schema'
import { OWNER, MEMBERS } from './family-config'

export interface FamilyVital {
  /** Display name from family-config (Lance, Heather, …). Always present. */
  displayName: string
  /** Family role ("Dad", "Mom", "Son", "Daughter"). */
  role: string
  /** True for Lance + anyone in MEMBERS with isParent. Drives whether
   *  the modal renders an Anniversary row for this slot. */
  isParent: boolean
  /** Hooked-up user id, when the member has accepted their invite. null
   *  for the not-yet-joined slot (per Lance's standing rule, keep the
   *  slot visible). */
  userId: string | null
  /** users.updatedAt as a ms timestamp — feeds /api/avatars/<id>?v=<ms>
   *  cache-busting so a re-cropped avatar shows up immediately. */
  updatedAtMs: number | null
  email: string | null
  phone: string | null
  /** Plaintext SSN — already decrypted server-side; popout shows it. */
  ssn: string | null
  driversLicense: string | null
  /** YYYY-MM-DD or null. Stored on users (new col); rendered next to DL # */
  driversLicenseExpiry: string | null
  passport: string | null
  /** Single-line address. Wraps in the modal layout but stored as one
   *  string — matches how the user-profile field works. */
  address: string | null
  /** YYYY-MM-DD or null. */
  dateOfBirth: string | null
  /** Parents-only date — Lance + Heather get an Anniversary row when set.
   *  Stored on users.anniversary as YYYY-MM-DD text. */
  anniversary: string | null
  /** Most-imminent registrationExpiry among vehicle (kind=Car/Truck/…)
   *  asset entries whose customFields.driverUserId points at this
   *  member. Renders under their row in the popout when set. */
  carRegExpiry: string | null
  /** First identity-entry whose firstName matches the member's display
   *  name. Used for the "View card →" deep-link. null when nobody has
   *  created one yet — the UI offers a Create Card link instead. */
  identityEntryId: string | null
}

export interface FamilyVitalsResult {
  members: FamilyVital[]
  /** Max users.updatedAt across the resolved roster — drives the
   *  "Updated Last" badge in the modal header. null when no users
   *  have been resolved (e.g. helper soft-failed). */
  lastUpdated: Date | null
}

const FORMAT_DOB = (d: Date | null | undefined): string | null => {
  if (!d) return null
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export async function getFamilyVitals(): Promise<FamilyVitalsResult> {
  // Pull every user with the popout-relevant columns. The base query
  // (phone/ssn/passport/etc.) is wrapped because those columns were
  // added across different migrations; the FOLLOW-UP query for the
  // two v258 additions (driversLicenseExpiry, anniversary) is wrapped
  // separately so a pre-migration prod still renders everything we
  // already had — only the new fields drop to null.
  type UserRow = {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    ssn: string | null
    driversLicense: string | null
    passport: string | null
    address: string | null
    dateOfBirth: Date | null
    updatedAt: Date | null
  }
  let allUsers: UserRow[] = []
  try {
    allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        ssn: users.ssn,
        driversLicense: users.driversLicense,
        passport: users.passport,
        address: users.address,
        dateOfBirth: users.dateOfBirth,
        updatedAt: users.updatedAt,
      })
      .from(users)
  } catch (err) {
    console.warn(
      '[family-vitals] user query failed (likely a missing recent column) — run `npm run db:push`.',
      err instanceof Error ? err.message : err,
    )
    return { members: [], lastUpdated: null }
  }

  // v258 additions — defensive second pass. If db:push hasn't been run
  // these columns are missing and the whole query throws; we swallow
  // and leave both maps empty so the popout still renders.
  const dlExpiryByUser = new Map<string, string>()
  const anniversaryByUser = new Map<string, string>()
  try {
    const extra = await db
      .select({
        id: users.id,
        driversLicenseExpiry: users.driversLicenseExpiry,
        anniversary: users.anniversary,
      })
      .from(users)
    for (const r of extra) {
      if (r.driversLicenseExpiry) dlExpiryByUser.set(r.id, r.driversLicenseExpiry)
      if (r.anniversary) anniversaryByUser.set(r.id, r.anniversary)
    }
  } catch (err) {
    console.warn(
      '[family-vitals] v258 extras (driversLicenseExpiry / anniversary) missing — run `npm run db:push`.',
      err instanceof Error ? err.message : err,
    )
  }

  // Roster in display order: OWNER (Lance) first, then MEMBERS in the
  // family-config order. Each entry pairs the config slug/display/role
  // with the candidate emails we match against the users table.
  // OWNER is implicitly a parent (matches getParentRecipients logic in
  // family-config); MEMBERS bring their own isParent flag.
  type RosterSlot = { displayName: string; role: string; isParent: boolean; emails: string[] }
  const roster: RosterSlot[] = [
    { displayName: OWNER.name, role: OWNER.role, isParent: true, emails: OWNER.emails },
    ...MEMBERS.map((m) => ({
      displayName: m.display,
      role: m.role,
      isParent: !!m.isParent,
      emails: m.emails ?? [],
    })),
  ]

  // Email match first (cheap + exact), fall back to first-name match on
  // users.name. Lance has aliases too (his GitHub handle) which the
  // OWNER block covers via .emails listing them.
  function matchUser(slot: RosterSlot): UserRow | null {
    const emailSet = new Set(slot.emails.map((e) => e.toLowerCase()))
    const byEmail = allUsers.find((u) => u.email && emailSet.has(u.email.toLowerCase()))
    if (byEmail) return byEmail
    const lower = slot.displayName.toLowerCase()
    const byName = allUsers.find((u) => (u.name ?? '').toLowerCase().split(/\s+/)[0] === lower)
    return byName ?? null
  }

  // Pull every identity entry's id + firstName in one shot — corpus is
  // small (one or two per family member). firstName is plaintext on
  // the entries table (not in ENTRY_ENCRYPTED_FIELDS), so no decrypt
  // pass needed. Index by lowercase first name so the popout can
  // resolve "Heather" → her entry id.
  type IdRow = { id: string; firstName: string | null }
  let identityRows: IdRow[] = []
  try {
    identityRows = await db
      .select({ id: entries.id, firstName: entries.firstName })
      .from(entries)
      .where(and(eq(entries.type, 'identity'), eq(entries.isPrivate, false)))
  } catch (err) {
    console.warn('[family-vitals] identity entries query failed.', err instanceof Error ? err.message : err)
  }
  const identityByFirstName = new Map<string, string>()
  for (const row of identityRows) {
    const first = (row.firstName ?? '').trim().toLowerCase()
    if (!first) continue
    if (!identityByFirstName.has(first)) identityByFirstName.set(first, row.id)
  }

  // Vehicle assets (v259) — query every asset entry, then filter
  // client-side to those whose customFields.driverUserId is set and
  // customFields.registrationExpiry is present. Build a map from
  // userId → earliest registrationExpiry so each member's row in the
  // popout shows the closest renewal they need to handle.
  type AssetRow = {
    customFields: Record<string, string> | null
  }
  let assetRows: AssetRow[] = []
  try {
    assetRows = (await db
      .select({ customFields: entries.customFields })
      .from(entries)
      .where(and(eq(entries.type, 'asset'), eq(entries.isPrivate, false)))) as AssetRow[]
  } catch (err) {
    console.warn('[family-vitals] asset query failed.', err instanceof Error ? err.message : err)
  }
  const carRegByUser = new Map<string, string>()
  for (const row of assetRows) {
    const cf = row.customFields
    if (!cf) continue
    const driverId = cf.driverUserId
    const expiry = cf.registrationExpiry
    if (!driverId || !expiry) continue
    const prev = carRegByUser.get(driverId)
    // Earliest expiry wins — that's the one the family needs to handle
    // first. Lexicographic compare works for ISO YYYY-MM-DD.
    if (!prev || expiry < prev) carRegByUser.set(driverId, expiry)
  }

  const members = roster.map((slot) => {
    const u = matchUser(slot)
    return {
      displayName: slot.displayName,
      role: slot.role,
      isParent: slot.isParent,
      userId: u?.id ?? null,
      updatedAtMs: u?.updatedAt ? u.updatedAt.getTime() : null,
      email: u?.email ?? null,
      phone: u?.phone ?? null,
      ssn: u?.ssn ?? null,
      driversLicense: u?.driversLicense ?? null,
      driversLicenseExpiry: u ? (dlExpiryByUser.get(u.id) ?? null) : null,
      passport: u?.passport ?? null,
      address: u?.address ?? null,
      dateOfBirth: FORMAT_DOB(u?.dateOfBirth),
      anniversary: u ? (anniversaryByUser.get(u.id) ?? null) : null,
      carRegExpiry: u ? (carRegByUser.get(u.id) ?? null) : null,
      identityEntryId: identityByFirstName.get(slot.displayName.toLowerCase()) ?? null,
    }
  })

  // Most-recent updatedAt across only the matched roster users — drives
  // the "Updated Last" badge. Anonymous users that aren't on the roster
  // don't count toward the family's "last touched" stamp.
  const matchedIds = new Set(members.map((m) => m.userId).filter(Boolean) as string[])
  let lastUpdated: Date | null = null
  for (const u of allUsers) {
    if (!matchedIds.has(u.id)) continue
    if (!u.updatedAt) continue
    if (!lastUpdated || u.updatedAt > lastUpdated) lastUpdated = u.updatedAt
  }

  return { members, lastUpdated }
}
