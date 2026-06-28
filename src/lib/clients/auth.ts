// Bearer-token auth for the /api/clients/* surface (browser extension,
// future mobile autofill). The web app's NextAuth session lives in a
// SameSite=Lax cookie that browsers don't send on cross-origin requests
// from third-party sites — so an extension content script can't piggy-
// back on it. Each paired client gets its own long-lived bearer token
// instead.
//
// Usage in a route handler:
//
//   const ctx = await requireClient(req)
//   if ('error' in ctx) return ctx.error
//   // ctx.userId, ctx.sessionId — proceed
//
// requireClient returns either a context object on success or a
// pre-built NextResponse on failure. Routes just spread it straight
// back to the caller.

import { NextResponse, type NextRequest } from 'next/server'
import { eq, and, isNull } from 'drizzle-orm'
import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { clientSessions } from '@/lib/db/schema'

export interface ClientAuthContext {
  userId: string
  sessionId: string
  sessionName: string
  platform: string
}

/**
 * SHA-256 the plaintext bearer token, hex-encoded. Used for both
 * insert (at pair time) and lookup (every request). Constant-time
 * comparison isn't strictly needed on the lookup since we use SQL
 * equality on the indexed hash column.
 */
export function hashClientToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Generate a fresh 32-byte token, base64url-encoded. Returned to the
 * client once at pair time; the server stores only its hash.
 */
export function generateClientToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** Read "Authorization: Bearer <token>" from a request. */
function readBearer(req: NextRequest | Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header) return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * Validate the Bearer token on an incoming request. On success returns
 * an auth context + bumps lastSeenAt. On failure returns a NextResponse
 * the route can `return` directly.
 */
export async function requireClient(
  req: NextRequest | Request,
): Promise<ClientAuthContext | { error: NextResponse }> {
  const token = readBearer(req)
  if (!token) {
    return { error: NextResponse.json({ error: 'Missing Bearer token.' }, { status: 401 }) }
  }
  const tokenHash = hashClientToken(token)

  const row = await db
    .select({
      id: clientSessions.id,
      userId: clientSessions.userId,
      name: clientSessions.name,
      platform: clientSessions.platform,
      revokedAt: clientSessions.revokedAt,
    })
    .from(clientSessions)
    .where(and(eq(clientSessions.tokenHash, tokenHash), isNull(clientSessions.revokedAt)))
    .then((r) => r[0])

  if (!row) {
    return { error: NextResponse.json({ error: 'Invalid or revoked token.' }, { status: 401 }) }
  }

  // Bump lastSeenAt without blocking the response — the client doesn't
  // need to wait for this update to land.
  db.update(clientSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(clientSessions.id, row.id))
    .catch((err) => console.warn('[clients/auth] lastSeenAt update failed:', err))

  return {
    userId: row.userId,
    sessionId: row.id,
    sessionName: row.name,
    platform: row.platform,
  }
}
