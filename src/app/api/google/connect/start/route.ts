import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import crypto from 'node:crypto'

// Kick off the Google OAuth flow that links the user's Gmail to their
// existing vault account (which they're already signed into via
// credentials). After consent, Google redirects back to /api/google/connect/
// callback where we exchange the code for refresh + access tokens and
// persist them in gmail_link.
//
// We DO NOT use NextAuth for this flow — NextAuth's account-linking
// semantics under JWT-strategy aren't a clean fit for "the user is already
// signed in, just attach Google as a secondary service". A direct OAuth
// implementation keeps the linking explicit and lets us own where the
// tokens land.

export const runtime = 'nodejs'

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID is not configured.' },
      { status: 500 },
    )
  }

  // CSRF protection: random nonce stored in a short-lived HttpOnly cookie
  // that the callback verifies against the `state` query param.
  const nonce = crypto.randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set({
    name: 'google_link_state',
    value: nonce,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 min — plenty of time to complete consent
    path: '/',
  })

  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/google/connect/callback`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES)
  // access_type=offline + prompt=consent guarantees Google returns a
  // refresh_token (otherwise we only get one on the first-ever link).
  // Without these the cron sync silently breaks 1 hour after connect.
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('state', nonce)

  return NextResponse.redirect(authUrl.toString())
}
