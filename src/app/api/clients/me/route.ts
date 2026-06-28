import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { requireClient } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'

// Bearer-auth ping. Used by the extension to confirm the saved token
// still works (e.g. on browser startup) and to display "Connected as
// <name>" in the popup. Doubles as the lastSeenAt heartbeat.

export const runtime = 'nodejs'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function GET(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const ctx = await requireClient(req)
  if ('error' in ctx) return ctx.error

  const user = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .then((r) => r[0])

  if (!user) return json({ error: 'User not found.' }, { status: 404 })

  return json({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    sessionId: ctx.sessionId,
    sessionName: ctx.sessionName,
    platform: ctx.platform,
  })
}
