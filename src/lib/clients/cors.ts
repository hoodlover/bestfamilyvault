// CORS helpers for the /api/clients/* routes the browser extension
// hits. The extension runs at chrome-extension://<id>/, so the
// browser sends an Origin header that doesn't match the vault's
// own origin and preflights any non-simple request.
//
// Allowed origins come from the CLIENT_EXT_ORIGINS env var (comma-
// separated). Set it after the extension's stable ID is known. In
// development you can include your local dev extension's id too.
//
// Bearer tokens (not cookies) carry our auth, so we never need
// `Access-Control-Allow-Credentials: true` — the CORS surface stays
// minimal: echo the Origin if it's allowed, return the typical
// methods/headers, and let the route do its thing.

import { NextResponse, type NextRequest } from 'next/server'

const ALLOWED_ORIGINS = (process.env.CLIENT_EXT_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/**
 * If the request's Origin is in the allowlist, return the headers we
 * need to send back. Otherwise return null — the caller leaves CORS
 * headers off and the browser blocks the response.
 */
export function corsHeadersFor(req: NextRequest | Request): Record<string, string> | null {
  const origin = req.headers.get('origin')
  if (!origin) return null
  if (!ALLOWED_ORIGINS.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Vary': 'Origin',
    // 5-minute preflight cache so chatty extensions don't hammer us.
    'Access-Control-Max-Age': '300',
  }
}

/** OPTIONS preflight handler — drop into any client route. */
export function corsPreflight(req: NextRequest | Request): NextResponse {
  const headers = corsHeadersFor(req) ?? {}
  return new NextResponse(null, { status: 204, headers })
}

/** Wrap a NextResponse with CORS headers if the origin is allowed. */
export function withCors(req: NextRequest | Request, res: NextResponse): NextResponse {
  const headers = corsHeadersFor(req)
  if (!headers) return res
  for (const [k, v] of Object.entries(headers)) {
    res.headers.set(k, v)
  }
  return res
}
