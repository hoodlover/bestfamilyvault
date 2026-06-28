import { NextResponse, type NextRequest } from 'next/server'
import { requireClient } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'

// No-op audit hook for v1. The extension calls this whenever the user
// fills a credential — gives us a place to add a real audit log later
// without changing the client. For now we just log to stdout so it
// shows up in Vercel logs.

export const runtime = 'nodejs'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const ctx = await requireClient(req)
  if ('error' in ctx) return ctx.error

  let body: { entryId?: unknown; domain?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const entryId = typeof body.entryId === 'string' ? body.entryId : null
  const domain = typeof body.domain === 'string' ? body.domain : null
  const action = typeof body.action === 'string' ? body.action : null

  console.log(
    `[${new Date().toISOString()}] client-autofill action=${action} ` +
    `user=${ctx.userId} session=${ctx.sessionId} domain=${domain} entry=${entryId}`
  )

  return json({ ok: true })
}
