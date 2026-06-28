import 'server-only'

import { and, eq, ne, or, sql } from 'drizzle-orm'
import { db } from './db'
import { entries, notes, letters, letterRelease } from './db/schema'
import { decryptEntryFields, decryptNote } from './crypto'
import { recipientSlugForUserName } from './letters-recipients'

export interface OnThisDayItem {
  kind: 'entry' | 'note' | 'letter'
  id: string
  title: string
  preview: string  // short snippet of body content
  createdAt: string  // ISO
  yearsAgo: number
  href: string
  /** Optional descriptor — for letters this is "video" / "voice" / "written". */
  flavor?: string
}

// Surfaces something the user already had in the vault on this same calendar
// day in any prior year. Returns null if nothing matches — caller hides the
// widget gracefully.
//
// Visibility mirrors /dashboard: superuser bypasses isPrivate but NOT
// isPersonal; everyone else sees only their own personal items + shared.

export async function pickOnThisDay(
  userId: string,
  role: string,
  userName?: string | null,
): Promise<OnThisDayItem | null> {
  const today = new Date()
  const month = today.getMonth() + 1
  const day = today.getDate()
  const isSuperuser = role === 'superuser'
  const myRecipientSlug = recipientSlugForUserName(userName)

  // Only items created BEFORE today (so freshly-created items don't appear
  // as "memories" the moment they're saved).
  const startOfToday = new Date(today)
  startOfToday.setHours(0, 0, 0, 0)

  const monthDayMatch = sql`extract(month from ${entries.createdAt}) = ${month} AND extract(day from ${entries.createdAt}) = ${day}`
  const monthDayMatchNotes = sql`extract(month from ${notes.createdAt}) = ${month} AND extract(day from ${notes.createdAt}) = ${day}`
  const monthDayMatchLetters = sql`extract(month from ${letters.createdAt}) = ${month} AND extract(day from ${letters.createdAt}) = ${day}`
  const beforeToday = sql`${entries.createdAt} < ${startOfToday}`
  const beforeTodayNotes = sql`${notes.createdAt} < ${startOfToday}`
  const beforeTodayLetters = sql`${letters.createdAt} < ${startOfToday}`

  // Letters are subject to the release gate: until releasedAt is set + in
  // the past, only the superuser can read them; everyone else only reads
  // their own (and only when the gate is open). Match the rules from
  // /letters page so On This Day never leaks an early letter to a kid.
  const releaseRow = await db.select().from(letterRelease).limit(1).then((r) => r[0])
  const isReleased = releaseRow?.releasedAt != null && releaseRow.releasedAt <= today

  const [matchedEntries, matchedNotes, matchedLetters] = await Promise.all([
    db.select().from(entries).where(
      and(
        monthDayMatch,
        beforeToday,
        // isPersonal owner-only; isPrivate superuser-only.
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        // Skip merged children — they're not browseable in the main UI.
        sql`${entries.parentEntryId} is null`,
        // Trivial low-signal filter: skip anything created today or with no title.
        ne(entries.title, ''),
      )
    ).limit(50),
    db.select().from(notes).where(
      and(
        monthDayMatchNotes,
        beforeTodayNotes,
        or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
        isSuperuser ? undefined : eq(notes.isPrivate, false),
        ne(notes.title, ''),
      )
    ).limit(50),
    // Letters: superuser sees all; non-superuser only sees own slot AND
    // only after release. Pre-release non-superuser query returns nothing.
    (async () => {
      if (isSuperuser) {
        return db.select().from(letters).where(and(monthDayMatchLetters, beforeTodayLetters)).limit(50)
      }
      if (isReleased && myRecipientSlug) {
        return db.select().from(letters).where(
          and(
            monthDayMatchLetters,
            beforeTodayLetters,
            eq(letters.recipientName, myRecipientSlug),
          ),
        ).limit(50)
      }
      return []
    })(),
  ])

  const pool: OnThisDayItem[] = []
  for (const e of matchedEntries) {
    const decrypted = decryptEntryFields(e)
    const yearsAgo = today.getFullYear() - new Date(e.createdAt).getFullYear()
    if (yearsAgo < 1) continue
    pool.push({
      kind: 'entry',
      id: e.id,
      title: e.title,
      preview: shortPreview(decrypted.noteContent ?? null) ?? `${e.type.replace('_', ' ')} entry`,
      createdAt: e.createdAt.toISOString(),
      yearsAgo,
      href: `/entries/${e.id}`,
    })
  }
  for (const n of matchedNotes) {
    const decrypted = decryptNote(n)
    const yearsAgo = today.getFullYear() - new Date(n.createdAt).getFullYear()
    if (yearsAgo < 1) continue
    pool.push({
      kind: 'note',
      id: n.id,
      title: n.title,
      preview: shortPreview(decrypted.content) ?? '',
      createdAt: n.createdAt.toISOString(),
      yearsAgo,
      href: `/notes/${n.id}`,
    })
  }
  for (const l of matchedLetters) {
    const yearsAgo = today.getFullYear() - new Date(l.createdAt).getFullYear()
    if (yearsAgo < 1) continue
    const flavor = l.contentType?.startsWith('video/')
      ? 'video letter'
      : l.contentType?.startsWith('audio/')
        ? 'voice letter'
        : 'written letter'
    pool.push({
      kind: 'letter',
      id: l.id,
      title: l.title,
      preview: shortPreview(l.body) ?? `for ${l.recipientName}`,
      createdAt: l.createdAt.toISOString(),
      yearsAgo,
      href: '/letters',
      flavor,
    })
  }

  if (pool.length === 0) return null

  // Random pick. Stable per-day-per-user is nicer (so refresh doesn't churn
  // the surface) but a session-stable hash isn't worth the bookkeeping —
  // refreshing the dashboard giving you a different memory is a feature.
  return pool[Math.floor(Math.random() * pool.length)]
}

function shortPreview(text: string | null): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.length <= 140) return trimmed
  return trimmed.slice(0, 140).trimEnd() + '…'
}
