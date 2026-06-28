// Per-user iCalendar feed. URL: /api/calendar/feed/<token>.ics
//
// Calendar apps (Google, Apple, Outlook) subscribe by URL. The token
// IS the auth — no cookies, no headers, just an unguessable URL the
// user copies from Settings. Token can be regenerated to invalidate
// any sharing.
//
// Includes:
//   - Subscription renewals (entries.subscriptionRenewsAt)
//   - Card / account expirations (entries.expiryDate)
//   - Family birthdays (users.dateOfBirth — annual recurring)
//
// Visibility mirrors normal vault rules — only events the token
// owner can see.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users, entries } from '@/lib/db/schema'
import { decryptEntries } from '@/lib/crypto'

export const runtime = 'nodejs'

interface CalEvent {
  uid: string         // stable across reads — calendar apps dedupe on this
  start: Date
  /** Optional all-day end date. If omitted, event is single-day all-day. */
  end?: Date
  summary: string
  description?: string
  /** RRULE for repeating events (e.g. annual birthdays). */
  rrule?: string
}

function parseExpiry(s: string): Date | null {
  const trimmed = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed)
  if (m) {
    const month = parseInt(m[1]) - 1
    let year = parseInt(m[2])
    if (year < 100) year += 2000
    return new Date(year, month + 1, 0)
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]), 0)
  return null
}

function parseRenewsAt(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim())
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  return null
}

function fmtIcsDate(d: Date): string {
  // All-day event date format: YYYYMMDD
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${dd}`
}

function fmtIcsDateTime(d: Date): string {
  // YYYYMMDDTHHMMSSZ (UTC)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
}

function buildIcs(events: CalEvent[], calName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Best Family Vault//Calendar Feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calName)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
  ]
  const dtstamp = fmtIcsDateTime(new Date())
  for (const e of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${e.uid}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART;VALUE=DATE:${fmtIcsDate(e.start)}`)
    if (e.end) lines.push(`DTEND;VALUE=DATE:${fmtIcsDate(e.end)}`)
    lines.push(`SUMMARY:${escapeIcsText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`)
    if (e.rrule) lines.push(`RRULE:${e.rrule}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // CRLF per RFC 5545.
  return lines.join('\r\n') + '\r\n'
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params
  // The URL ends in .ics — strip that suffix before lookup.
  const token = rawToken.replace(/\.ics$/i, '')
  if (!token || token.length < 16) {
    return new NextResponse('Invalid token', { status: 404 })
  }

  const user = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.calendarToken, token))
    .then((r) => r[0])
  if (!user) {
    return new NextResponse('Token not recognized — regenerate from Settings.', { status: 404 })
  }

  const isSuperuser = user.role === 'superuser'

  // Pull dated entries this user can see.
  const datedEntries = await db
    .select()
    .from(entries)
    .where(and(
      isSuperuser ? undefined : eq(entries.isPrivate, false),
      or(eq(entries.isPersonal, false), eq(entries.createdBy, user.id)),
      isNull(entries.parentEntryId),
      or(
        isNotNull(entries.subscriptionRenewsAt),
        isNotNull(entries.expiryDate),
      ),
    ))
  const decrypted = decryptEntries(datedEntries)

  // Family birthdays (annual recurring).
  const familyDobs = await db
    .select({ id: users.id, name: users.name, dateOfBirth: users.dateOfBirth })
    .from(users)
    .where(isNotNull(users.dateOfBirth))

  const events: CalEvent[] = []

  for (const e of decrypted) {
    if (e.isRecurring && e.subscriptionRenewsAt) {
      const d = parseRenewsAt(e.subscriptionRenewsAt)
      if (d) {
        const amount = e.subscriptionAmountCents != null
          ? ` — $${(e.subscriptionAmountCents / 100).toFixed(2)}${e.subscriptionPeriod ? `/${e.subscriptionPeriod}` : ''}`
          : ''
        events.push({
          uid: `vault-renew-${e.id}@vault`,
          start: d,
          summary: `Renews: ${e.title}${amount}`,
          description: e.url ?? '',
        })
      }
    }
    if ((e.type === 'credit_card' || e.type === 'bank_account') && e.expiryDate) {
      const d = parseExpiry(e.expiryDate)
      if (d) {
        events.push({
          uid: `vault-expiry-${e.id}@vault`,
          start: d,
          summary: `Expires: ${e.title}`,
          description: '',
        })
      }
    }
  }

  for (const u of familyDobs) {
    if (!u.dateOfBirth) continue
    const dob = u.dateOfBirth
    const firstName = (u.name ?? '').split(' ')[0] || u.name || 'Family'
    events.push({
      uid: `vault-birthday-${u.id}@vault`,
      start: dob,
      summary: `🎂 ${firstName}'s birthday`,
      description: '',
      rrule: `FREQ=YEARLY;BYMONTH=${dob.getMonth() + 1};BYMONTHDAY=${dob.getDate()}`,
    })
  }

  const calName = user.name ? `${user.name.split(' ')[0]}'s Vault Calendar` : 'Vault Calendar'
  const ics = buildIcs(events, calName)

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="vault.ics"',
      'Cache-Control': 'private, max-age=600', // 10-min cache; calendar apps poll typically every few hours anyway
    },
  })
}
