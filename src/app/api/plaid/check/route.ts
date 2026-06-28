// Debug endpoint — returns which Plaid env vars are visible to the
// running server process. Returns only presence (true/false), never
// values, so it's safe to hit in a browser. Superuser-only so it
// doesn't leak env presence to random visitors.
//
// Hit at: /api/plaid/check

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'superuser') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({
    PLAID_CLIENT_ID: Boolean(process.env.PLAID_CLIENT_ID),
    PLAID_ENV: process.env.PLAID_ENV ?? null,
    PLAID_SECRET_SANDBOX: Boolean(process.env.PLAID_SECRET_SANDBOX),
    PLAID_SECRET_PRODUCTION: Boolean(process.env.PLAID_SECRET_PRODUCTION),
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  })
}
