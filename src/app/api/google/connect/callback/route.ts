import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { gmailLinks } from '@/lib/db/schema'

// Google's redirect lands here after the consent screen. Validate the
// state nonce, exchange the auth code for tokens, fetch the user's Gmail
// address (for display), and upsert into gmail_link.

export const runtime = 'nodejs'

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
  id_token?: string
}

interface UserInfo {
  email?: string
  email_verified?: boolean
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  // User declined / Google sent an error.
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/settings?gmailLinkError=${encodeURIComponent(errorParam)}`, request.url),
    )
  }
  if (!code) {
    return NextResponse.redirect(new URL('/settings?gmailLinkError=missing_code', request.url))
  }

  // CSRF: verify the state we issued in /start matches the one Google
  // bounced back. Wipe the cookie regardless so it's not reusable.
  const cookieStore = await cookies()
  const expected = cookieStore.get('google_link_state')?.value
  cookieStore.delete('google_link_state')
  if (!expected || expected !== state) {
    return NextResponse.redirect(new URL('/settings?gmailLinkError=bad_state', request.url))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/settings?gmailLinkError=server_misconfigured', request.url))
  }

  const redirectUri = `${url.origin}/api/google/connect/callback`

  // Exchange the auth code for tokens.
  let tokens: TokenResponse
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('[gmail-link] token exchange failed:', res.status, text)
      return NextResponse.redirect(new URL('/settings?gmailLinkError=token_exchange', request.url))
    }
    tokens = (await res.json()) as TokenResponse
  } catch (err) {
    console.error('[gmail-link] token fetch threw:', err)
    return NextResponse.redirect(new URL('/settings?gmailLinkError=token_exchange', request.url))
  }

  // No refresh_token = we'll be unable to sync later. This happens if
  // the user has previously consented for this client without a fresh
  // prompt=consent. Bail loudly so the user knows to retry; the start
  // route forces prompt=consent so this should be rare.
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL('/settings?gmailLinkError=no_refresh_token', request.url))
  }

  // Fetch the linked Gmail address for display.
  let gmailEmail = ''
  try {
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (ui.ok) {
      const info = (await ui.json()) as UserInfo
      if (info.email) gmailEmail = info.email
    }
  } catch {
    // Non-fatal — sync still works, the address is just for display.
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  // Upsert: a user can re-connect at any time and their existing
  // sync_token / last_synced_at survive.
  const existing = await db
    .select({ userId: gmailLinks.userId })
    .from(gmailLinks)
    .where(eq(gmailLinks.userId, session.user.id))
    .then((r) => r[0])

  if (existing) {
    await db
      .update(gmailLinks)
      .set({
        gmailEmail,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope ?? null,
        updatedAt: new Date(),
      })
      .where(eq(gmailLinks.userId, session.user.id))
  } else {
    await db.insert(gmailLinks).values({
      userId: session.user.id,
      gmailEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? null,
    })
  }

  console.log(
    `[${new Date().toISOString()}] gmail linked: user=${session.user.email ?? session.user.id} gmail=${gmailEmail}`,
  )

  return NextResponse.redirect(new URL('/settings?gmailLinked=1', request.url))
}
