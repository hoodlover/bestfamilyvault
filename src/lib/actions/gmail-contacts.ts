'use server'

// Gmail contacts: per-user CRUD on the local rows + the two-way sync
// orchestrator that pushes vault changes up to Google and pulls remote
// changes down.

import { and, asc, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { gmailContacts, gmailLinks } from '@/lib/db/schema'
import {
  createPersonOnGoogle,
  dedupeByKey,
  deletePersonOnGoogle,
  fetchContactsPage,
  normalizeAddressString,
  updatePersonOnGoogle,
} from '@/lib/google-people'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

function bumpUpdatedPaths() {
  revalidatePath('/contacts')
  revalidatePath('/settings')
}

// ─── Read helpers ───────────────────────────────────────────────────────────

export interface ContactRow {
  id: string
  displayName: string | null
  givenName: string | null
  familyName: string | null
  emails: Array<{ value: string; type?: string | null }>
  phones: Array<{ value: string; type?: string | null }>
  addresses: Array<{ value: string; type?: string | null }>
  organization: string | null
  jobTitle: string | null
  birthday: string | null
  notes: string | null
  syncStatus: string
  isFavorite: boolean
  updatedAt: Date
}

export async function listMyContacts(): Promise<ContactRow[]> {
  const session = await requireUser()
  const rows = await db
    .select()
    .from(gmailContacts)
    .where(
      and(
        eq(gmailContacts.userId, session.user.id),
        // Exclude soft-deleted rows from the visible list. They linger in
        // the table only until the next sync pushes the delete to Gmail.
        isNull(gmailContacts.deletedAt),
      ),
    )
    // Favorited contacts float to the top. Within each favorite tier
    // we fall back to alphabetic display name (then family name) so
    // the existing sort is preserved.
    .orderBy(desc(gmailContacts.isFavorite), asc(gmailContacts.displayName), asc(gmailContacts.familyName))
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    givenName: r.givenName,
    familyName: r.familyName,
    emails: r.emails ?? [],
    phones: r.phones ?? [],
    addresses: r.addresses ?? [],
    organization: r.organization,
    jobTitle: r.jobTitle,
    birthday: r.birthday,
    notes: r.notes,
    syncStatus: r.syncStatus,
    isFavorite: r.isFavorite,
    updatedAt: r.updatedAt,
  }))
}

// Toggle the per-row star. Does NOT round-trip to Google — favorites are
// vault-local (Google's People API has no equivalent flag).
export async function setContactFavorite(contactId: string, isFavorite: boolean) {
  const session = await requireUser()
  const row = await db
    .select({ id: gmailContacts.id, userId: gmailContacts.userId })
    .from(gmailContacts)
    .where(eq(gmailContacts.id, contactId))
    .then((r) => r[0])
  if (!row || row.userId !== session.user.id) {
    return { error: 'Contact not found.' }
  }
  await db
    .update(gmailContacts)
    .set({ isFavorite, updatedAt: new Date() })
    .where(eq(gmailContacts.id, contactId))
  revalidatePath('/contacts')
  return { success: true as const }
}

export async function getMyGmailLink(): Promise<{
  linked: boolean
  gmailEmail: string | null
  syncFrequency: string
  lastSyncedAt: Date | null
}> {
  const session = await requireUser()
  const link = await db
    .select({
      gmailEmail: gmailLinks.gmailEmail,
      syncFrequency: gmailLinks.syncFrequency,
      lastSyncedAt: gmailLinks.lastSyncedAt,
    })
    .from(gmailLinks)
    .where(eq(gmailLinks.userId, session.user.id))
    .then((r) => r[0])
  if (!link) return { linked: false, gmailEmail: null, syncFrequency: 'manual', lastSyncedAt: null }
  return { linked: true, ...link }
}

// ─── CRUD (local-first, queues a push to Gmail on next sync) ───────────────

interface ContactInput {
  displayName?: string | null
  givenName?: string | null
  familyName?: string | null
  emails?: Array<{ value: string; type?: string | null }>
  phones?: Array<{ value: string; type?: string | null }>
  addresses?: Array<{ value: string; type?: string | null }>
  organization?: string | null
  jobTitle?: string | null
  birthday?: string | null
  notes?: string | null
}

interface CleanedContact {
  displayName: string | null
  givenName: string | null
  familyName: string | null
  // The schema's json() column expects `type?: string` (not nullable), so
  // we strip nulls here on the way in.
  emails: Array<{ value: string; type?: string }>
  phones: Array<{ value: string; type?: string }>
  addresses: Array<{ value: string; type?: string }>
  organization: string | null
  jobTitle: string | null
  birthday: string | null
  notes: string | null
}

function clean(input: ContactInput): CleanedContact {
  const trim = (s: string | null | undefined) => {
    const t = (s ?? '').trim()
    return t === '' ? null : t
  }
  const stripType = (arr: Array<{ value: string; type?: string | null }> | undefined) =>
    (arr ?? [])
      .filter((x) => (x.value ?? '').trim() !== '')
      .map((x) => ({ value: x.value, type: x.type ?? undefined }))
  return {
    displayName: trim(input.displayName),
    givenName: trim(input.givenName),
    familyName: trim(input.familyName),
    emails: stripType(input.emails),
    phones: stripType(input.phones),
    addresses: stripType(input.addresses),
    organization: trim(input.organization),
    jobTitle: trim(input.jobTitle),
    birthday: trim(input.birthday),
    notes: trim(input.notes),
  }
}

export async function createContactLocal(input: ContactInput) {
  const session = await requireUser()
  const c = clean(input)
  const display = c.displayName || [c.givenName, c.familyName].filter(Boolean).join(' ') || null
  if (!display && (c.emails?.length ?? 0) === 0 && (c.phones?.length ?? 0) === 0) {
    return { error: 'Add a name, email, or phone.' }
  }
  await db.insert(gmailContacts).values({
    userId: session.user.id,
    displayName: display,
    givenName: c.givenName ?? null,
    familyName: c.familyName ?? null,
    emails: c.emails ?? [],
    phones: c.phones ?? [],
    addresses: c.addresses ?? [],
    organization: c.organization ?? null,
    jobTitle: c.jobTitle ?? null,
    birthday: c.birthday ?? null,
    notes: c.notes ?? null,
    syncStatus: 'local_created',
  })
  bumpUpdatedPaths()
  return { success: true }
}

export async function updateContactLocal(id: string, input: ContactInput) {
  const session = await requireUser()
  const existing = await db
    .select()
    .from(gmailContacts)
    .where(and(eq(gmailContacts.id, id), eq(gmailContacts.userId, session.user.id)))
    .then((r) => r[0])
  if (!existing) return { error: 'Contact not found.' }

  const c = clean(input)
  const display = c.displayName || [c.givenName, c.familyName].filter(Boolean).join(' ') || existing.displayName

  // If the row was 'local_created', stay 'local_created' — it hasn't
  // been pushed yet, so an edit is just a refinement of the queued create.
  // Otherwise mark 'local_modified' so the next sync sends a PATCH.
  const nextStatus = existing.syncStatus === 'local_created' ? 'local_created' : 'local_modified'

  await db
    .update(gmailContacts)
    .set({
      displayName: display,
      givenName: c.givenName ?? null,
      familyName: c.familyName ?? null,
      emails: c.emails ?? [],
      phones: c.phones ?? [],
      addresses: c.addresses ?? [],
      organization: c.organization ?? null,
      jobTitle: c.jobTitle ?? null,
      birthday: c.birthday ?? null,
      notes: c.notes ?? null,
      syncStatus: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(gmailContacts.id, id))

  bumpUpdatedPaths()
  return { success: true }
}

export async function deleteContactLocal(id: string) {
  const session = await requireUser()
  const existing = await db
    .select({ id: gmailContacts.id, googleResourceName: gmailContacts.googleResourceName })
    .from(gmailContacts)
    .where(and(eq(gmailContacts.id, id), eq(gmailContacts.userId, session.user.id)))
    .then((r) => r[0])
  if (!existing) return { error: 'Contact not found.' }

  // If the contact never made it to Gmail (no resource name), just hard-
  // delete locally — no remote cleanup needed.
  if (!existing.googleResourceName) {
    await db.delete(gmailContacts).where(eq(gmailContacts.id, id))
  } else {
    await db
      .update(gmailContacts)
      .set({ syncStatus: 'pending_delete', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(gmailContacts.id, id))
  }

  bumpUpdatedPaths()
  return { success: true }
}

// ─── Settings actions ───────────────────────────────────────────────────────

export async function setGmailSyncFrequency(frequency: 'manual' | 'hourly' | 'daily' | 'weekly') {
  const session = await requireUser()
  await db
    .update(gmailLinks)
    .set({ syncFrequency: frequency, updatedAt: new Date() })
    .where(eq(gmailLinks.userId, session.user.id))
  bumpUpdatedPaths()
  return { success: true }
}

export async function disconnectGmail(opts: { wipeContacts: boolean }) {
  const session = await requireUser()
  if (opts.wipeContacts) {
    await db.delete(gmailContacts).where(eq(gmailContacts.userId, session.user.id))
  }
  await db.delete(gmailLinks).where(eq(gmailLinks.userId, session.user.id))
  bumpUpdatedPaths()
  return { success: true }
}

// ─── The orchestrator ───────────────────────────────────────────────────────

interface SyncOutcome {
  pushedCreated: number
  pushedUpdated: number
  pushedDeleted: number
  pulledUpserted: number
  pulledDeleted: number
  errors: string[]
}

/**
 * Two-way sync for one user. Push first so a vault delete that hasn't
 * propagated yet doesn't get re-pulled as a remote add. Pull second
 * using the stored sync token (incremental) or a full fetch (when token
 * is null or expired).
 */
export async function syncContactsForUser(userId: string): Promise<SyncOutcome> {
  const result: SyncOutcome = {
    pushedCreated: 0,
    pushedUpdated: 0,
    pushedDeleted: 0,
    pulledUpserted: 0,
    pulledDeleted: 0,
    errors: [],
  }

  // ─── PUSH ────────────────────────────────────────────────────────────────
  // Local creates → POST to People API.
  const toCreate = await db
    .select()
    .from(gmailContacts)
    .where(and(eq(gmailContacts.userId, userId), eq(gmailContacts.syncStatus, 'local_created')))
  for (const row of toCreate) {
    try {
      const { resourceName, etag } = await createPersonOnGoogle(userId, row)
      await db
        .update(gmailContacts)
        .set({
          googleResourceName: resourceName,
          googleEtag: etag,
          syncStatus: 'synced',
          updatedAt: new Date(),
        })
        .where(eq(gmailContacts.id, row.id))
      result.pushedCreated++
    } catch (err) {
      result.errors.push(`create ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Local edits → PATCH on People API.
  const toUpdate = await db
    .select()
    .from(gmailContacts)
    .where(
      and(
        eq(gmailContacts.userId, userId),
        eq(gmailContacts.syncStatus, 'local_modified'),
        isNotNull(gmailContacts.googleResourceName),
      ),
    )
  for (const row of toUpdate) {
    try {
      const { etag } = await updatePersonOnGoogle(
        userId,
        row.googleResourceName!,
        row.googleEtag ?? '',
        row,
      )
      await db
        .update(gmailContacts)
        .set({ googleEtag: etag, syncStatus: 'synced', updatedAt: new Date() })
        .where(eq(gmailContacts.id, row.id))
      result.pushedUpdated++
    } catch (err) {
      // 409 conflict (stale etag) → leave as 'local_modified', the pull
      // step will fetch the remote version. The user's edit gets clobbered
      // — v1 behaviour, documented in the plan.
      result.errors.push(`update ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Pending deletes → DELETE on People API, then hard-delete locally.
  const toDelete = await db
    .select()
    .from(gmailContacts)
    .where(
      and(
        eq(gmailContacts.userId, userId),
        eq(gmailContacts.syncStatus, 'pending_delete'),
        isNotNull(gmailContacts.googleResourceName),
      ),
    )
  for (const row of toDelete) {
    try {
      await deletePersonOnGoogle(userId, row.googleResourceName!)
      await db.delete(gmailContacts).where(eq(gmailContacts.id, row.id))
      result.pushedDeleted++
    } catch (err) {
      result.errors.push(`delete ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ─── PULL ────────────────────────────────────────────────────────────────
  const link = await db
    .select({ syncToken: gmailLinks.syncToken })
    .from(gmailLinks)
    .where(eq(gmailLinks.userId, userId))
    .then((r) => r[0])

  let useToken: string | null = link?.syncToken ?? null
  let fellBackToFull = false

  // First pass: try incremental. If Google says the token is stale,
  // fall through to a full fetch.
  let pageToken: string | null = null
  let nextSyncToken: string | null = null
  do {
    const page = await fetchContactsPage(userId, { syncToken: useToken, pageToken })
    if (page.expiredSyncToken && useToken) {
      // Token expired — restart with no token (full fetch).
      useToken = null
      fellBackToFull = true
      pageToken = null
      nextSyncToken = null
      continue
    }

    // Upsert each remote contact by (userId, googleResourceName).
    for (const remote of page.contacts) {
      if (!remote.googleResourceName) continue
      const existing = await db
        .select({ id: gmailContacts.id, syncStatus: gmailContacts.syncStatus })
        .from(gmailContacts)
        .where(
          and(
            eq(gmailContacts.userId, userId),
            eq(gmailContacts.googleResourceName, remote.googleResourceName),
          ),
        )
        .then((r) => r[0])
      if (existing) {
        // Don't overwrite a row the user is currently editing locally
        // (status != 'synced'). Pull-side will catch up on the next sync
        // after the local edit pushes successfully.
        if (existing.syncStatus !== 'synced') continue
        await db
          .update(gmailContacts)
          .set({ ...remote, updatedAt: new Date() })
          .where(eq(gmailContacts.id, existing.id))
      } else {
        await db.insert(gmailContacts).values(remote)
      }
      result.pulledUpserted++
    }

    // Apply remote deletions. Skip rows the user is mid-edit on locally.
    for (const rn of page.deletedResourceNames) {
      const removed = await db
        .delete(gmailContacts)
        .where(
          and(
            eq(gmailContacts.userId, userId),
            eq(gmailContacts.googleResourceName, rn),
            eq(gmailContacts.syncStatus, 'synced'),
          ),
        )
        .returning({ id: gmailContacts.id })
      if (removed.length > 0) result.pulledDeleted++
    }

    pageToken = page.nextPageToken
    if (!pageToken) nextSyncToken = page.nextSyncToken
  } while (pageToken)

  // Persist the new sync token + last_synced_at.
  await db
    .update(gmailLinks)
    .set({
      syncToken: nextSyncToken ?? null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(gmailLinks.userId, userId))

  if (fellBackToFull) {
    // Informational, not an error. Helps debugging.
    console.log(`[gmail-sync] user=${userId} fell back to full fetch (sync token expired)`)
  }
  // Suppress unused-variable lint for the helper import.
  void ne
  return result
}

/**
 * One-shot cleanup pass over the current user's contacts:
 *   • Dedupes emails (case-insensitive on the value)
 *   • Dedupes phones (digits-only on the value, formatting preserved on
 *     whichever copy survives)
 *   • Reformats addresses to the canonical 3-line shape
 *     (street / city, state zip / country)
 *
 * Each row that actually changed gets bumped to syncStatus = 'local_modified'
 * so the next Sync Now pushes the cleanup back to Gmail too.
 */
export async function normalizeMyContacts(): Promise<
  { success: true; modified: number; scanned: number } | { error: string }
> {
  let session
  try {
    session = await requireUser()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unauthorized' }
  }
  const rows = await db
    .select()
    .from(gmailContacts)
    .where(eq(gmailContacts.userId, session.user.id))

  let modified = 0
  for (const row of rows) {
    const beforeEmails = JSON.stringify(row.emails ?? [])
    const beforePhones = JSON.stringify(row.phones ?? [])
    const beforeAddresses = JSON.stringify(row.addresses ?? [])

    const emails = dedupeByKey(
      row.emails ?? [],
      (e: { value: string }) => e.value.trim().toLowerCase(),
    )
    const phones = dedupeByKey(
      row.phones ?? [],
      (p: { value: string }) => p.value.replace(/\D/g, ''),
    )
    const addresses = (row.addresses ?? []).map((a) => ({
      value: normalizeAddressString(a.value),
      ...(a.type ? { type: a.type as string } : {}),
    }))

    const afterEmails = JSON.stringify(emails)
    const afterPhones = JSON.stringify(phones)
    const afterAddresses = JSON.stringify(addresses)

    if (
      afterEmails === beforeEmails &&
      afterPhones === beforePhones &&
      afterAddresses === beforeAddresses
    ) continue

    // Don't reset rows that are already in a non-synced state (we'd lose
    // an in-flight create or pending delete). Only bump a clean 'synced'
    // row to 'local_modified' so the next sync pushes the cleanup.
    const nextStatus = row.syncStatus === 'synced' ? 'local_modified' : row.syncStatus

    await db
      .update(gmailContacts)
      .set({
        emails,
        phones,
        addresses,
        syncStatus: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(gmailContacts.id, row.id))
    modified++
  }

  bumpUpdatedPaths()
  return { success: true, modified, scanned: rows.length }
}

/** Wraps syncContactsForUser with auth — used by the manual "Sync now"
 *  button on the contacts / settings pages. */
export async function triggerSyncNow() {
  const session = await requireUser()
  try {
    const outcome = await syncContactsForUser(session.user.id)
    bumpUpdatedPaths()
    return { success: true, outcome }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Sync failed.' }
  }
}
