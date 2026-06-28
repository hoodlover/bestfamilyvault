// Generates a short-lived link_token the browser uses to open Plaid Link.
// One per Link session — Plaid expects you to mint a fresh one each time
// the user opens the widget. The token encodes the products + redirect
// behavior so the client doesn't need to know those details.

import { NextRequest, NextResponse } from 'next/server'
import { Products, CountryCode } from 'plaid'
import { auth } from '@/lib/auth'
import { plaid } from '@/lib/plaid'
import { APP_NAME } from '@/lib/branding'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role === 'readonly') {
    return NextResponse.json({ error: 'Read-only access.' }, { status: 403 })
  }

  try {
    const res = await plaid().linkTokenCreate({
      // Plaid uses the client's user ID to link a session back to a
      // specific person on its end — useful for analytics + multi-tenant
      // limit tracking. We pass the vault user's id directly.
      user: { client_user_id: session.user.id },
      client_name: APP_NAME,
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    return NextResponse.json({ link_token: res.data.link_token })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plaid/link-token] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
