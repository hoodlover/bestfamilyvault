// Daily cron — delete login_attempt rows older than 7 days so the table
// doesn't grow unbounded. The 15-minute rolling window only ever queries
// recent rows; everything past a week is dead weight.
//
// Authorization: matches the existing cron pattern. Vercel adds an
// Authorization: Bearer ${CRON_SECRET} header automatically when calling
// scheduled endpoints; bail if it doesn't match. Schedule lives in
// vercel.json.

import { NextResponse } from 'next/server'
import { lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { loginAttempts } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RETENTION_DAYS = 7

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
    // returning so we can report how many we dropped.
    const dropped = await db
      .delete(loginAttempts)
      .where(lt(loginAttempts.attemptedAt, cutoff))
      .returning({ id: loginAttempts.id })

    return NextResponse.json({
      ok: true,
      dropped: dropped.length,
      retentionDays: RETENTION_DAYS,
      ranAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[prune-login-attempts] failed:', e)
    return NextResponse.json({ error: 'Prune failed.', detail: String(e) }, { status: 500 })
  }
}

