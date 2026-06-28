// Weekly digest email cron. Runs every Sunday at 18:00 UTC (configured
// in vercel.json). For each user with an email + verified status, builds
// a personal digest and sends it via the existing SMTP transport.
//
// Vercel cron sends `Authorization: Bearer $CRON_SECRET`. Set CRON_SECRET
// to a long random string in Vercel env vars; otherwise the route will
// only run for unauthenticated requests in dev (still safe; just won't
// fire from prod cron).

import { NextRequest, NextResponse } from 'next/server'
import { isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { buildWeeklyDigest, renderDigest } from '@/lib/digest'
import { sendEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const maxDuration = 60

function appBaseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  // Fallback to the request's own origin.
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

export async function GET(req: NextRequest) {
  // Vercel cron delivers `Authorization: Bearer $CRON_SECRET`. Reject
  // anything else if CRON_SECRET is set. (Local invocation without a
  // secret stays allowed so devs can hit the endpoint manually.)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const baseUrl = appBaseUrl(req)
  const allUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNotNull(users.email))

  let sent = 0
  let skippedEmpty = 0
  let errors: Array<{ userId: string; error: string }> = []

  for (const u of allUsers) {
    if (!u.email) continue
    try {
      const digest = await buildWeeklyDigest(u.id)
      if (!digest) continue
      const rendered = renderDigest(digest, baseUrl)
      if (!rendered) {
        skippedEmpty++
        continue
      }
      await sendEmail({
        to: u.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })
      sent++
    } catch (err) {
      errors.push({
        userId: u.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  console.log(
    `[${new Date().toISOString()}] weekly-digest run: sent=${sent} skippedEmpty=${skippedEmpty} errors=${errors.length}`,
  )

  return NextResponse.json({ sent, skippedEmpty, errors, totalUsers: allUsers.length })
}
