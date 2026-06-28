import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { startPairCode } from '@/lib/actions/client-sessions'

// Web-session-authed (cookie). The user has the vault open and tapped
// "Pair new device" — we mint a 6-digit code that the extension/app
// then redeems via /api/clients/pair/complete.
//
// Used by the Linked Devices settings panel. The actual settings UI
// could call the server action directly, but a real HTTP route makes
// the surface symmetric with /pair/complete and gives us a place to
// hang anything device-specific later.

export const runtime = 'nodejs'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const res = await startPairCode()
  if ('error' in res) {
    return NextResponse.json({ error: res.error }, { status: 500 })
  }
  return NextResponse.json({ code: res.code, expiresAt: res.expiresAt.toISOString() })
}
