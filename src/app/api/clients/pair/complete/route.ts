import { NextResponse, type NextRequest } from 'next/server'
import { eq, and, gt, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { clientSessions, clientPairCodes, users } from '@/lib/db/schema'
import { generateClientToken, hashClientToken } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'

// Anonymous endpoint hit by the browser extension / mobile app. It has
// the 6-digit code the user copied off the vault's settings screen +
// the device name they typed and the platform. We validate the code,
// mark it consumed, mint a long-lived bearer token, store its hash on
// a new client_session row, and hand the plaintext token back. From
// here on the client uses Authorization: Bearer <token>.
//
// CORS: the extension origin (chrome-extension://...) gets the headers
// when listed in CLIENT_EXT_ORIGINS. Tokens (not cookies) carry our
// auth, so we never set Allow-Credentials.

export const runtime = 'nodejs'

interface CompleteBody {
  code?: unknown
  name?: unknown
  platform?: unknown
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  let body: CompleteBody
  try {
    body = (await req.json()) as CompleteBody
  } catch {
    return json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const platform = typeof body.platform === 'string' ? body.platform.trim() : ''

  if (!/^\d{6}$/.test(code)) return json({ error: 'Code must be 6 digits.' }, { status: 400 })
  if (!name) return json({ error: 'Device name is required.' }, { status: 400 })
  if (!['extension', 'android', 'ios'].includes(platform)) {
    return json({ error: 'Invalid platform.' }, { status: 400 })
  }

  // Look up the code: must exist, not be consumed, not be expired.
  const codeRow = await db
    .select({
      code: clientPairCodes.code,
      userId: clientPairCodes.userId,
    })
    .from(clientPairCodes)
    .where(and(
      eq(clientPairCodes.code, code),
      isNull(clientPairCodes.consumedAt),
      gt(clientPairCodes.expiresAt, new Date()),
    ))
    .then((r) => r[0])

  if (!codeRow) {
    return json({ error: 'Code is invalid, expired, or already used.' }, { status: 400 })
  }

  // Mint a fresh bearer token, store its hash. Plaintext token is
  // returned exactly once — if the client loses it we re-pair.
  const token = generateClientToken()
  const tokenHash = hashClientToken(token)

  // Mark the code consumed first; if the insert below fails we don't
  // want the code re-usable, but we'd want to know about the failure
  // so the user can retry with a fresh code.
  await db
    .update(clientPairCodes)
    .set({ consumedAt: new Date() })
    .where(eq(clientPairCodes.code, code))

  const [created] = await db
    .insert(clientSessions)
    .values({
      userId: codeRow.userId,
      name,
      platform,
      tokenHash,
    })
    .returning({ id: clientSessions.id })

  // Pull the user's name for the client to display ("Connected as Lance").
  const user = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, codeRow.userId))
    .then((r) => r[0])

  return json({
    token,
    sessionId: created.id,
    userName: user?.name ?? null,
  })
}
