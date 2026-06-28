// Vercel cron endpoint that walks every user with Gmail linked and runs
// their sync if they're "due" based on syncFrequency. Manual users are
// never picked up here — they only sync when they tap "Sync now".
//
// Gated by CRON_SECRET like /api/cron/reset-demo. Vercel cron adds the
// Authorization: Bearer <CRON_SECRET> header automatically; manual hits
// without the secret 401.
//
// Cron schedule registered in vercel.json (hourly: "0 * * * *"). Hourly
// is fine grain enough for hourly/daily/weekly users. The frequency
// picker just controls how often a user is "due" to run, not how often
// the cron itself fires.

import { NextResponse } from 'next/server'
import { eq, ne } from 'drizzle-orm'
import { db } from '@/lib/db'
import { gmailLinks } from '@/lib/db/schema'
import { syncContactsForUser } from '@/lib/actions/gmail-contacts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const candidates = await db
    .select({
      userId: gmailLinks.userId,
      syncFrequency: gmailLinks.syncFrequency,
      lastSyncedAt: gmailLinks.lastSyncedAt,
    })
    .from(gmailLinks)
    .where(ne(gmailLinks.syncFrequency, 'manual'))

  const now = Date.now()
  const due = candidates.filter((c) => {
    const interval = FREQUENCY_MS[c.syncFrequency]
    if (!interval) return false
    if (!c.lastSyncedAt) return true // never synced — go now
    return now - c.lastSyncedAt.getTime() >= interval
  })

  let synced = 0
  let errored = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const u of due) {
    try {
      await syncContactsForUser(u.userId)
      synced++
    } catch (err) {
      errored++
      errors.push({
        userId: u.userId,
        error: err instanceof Error ? err.message : String(err),
      })
      console.error(`[cron sync-gmail-contacts] user=${u.userId} failed:`, err)
    }
  }

  // Suppress unused-import lint for eq.
  void eq
  return NextResponse.json({
    scanned: candidates.length,
    due: due.length,
    synced,
    errored,
    errors,
  })
}
