import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { revokeClientSession } from '@/lib/actions/client-sessions'

// Web-session-authed (cookie). The user tapped Revoke on the Linked
// Devices panel. revokeClientSession() bumps revoked_at on the row;
// the auth middleware then refuses any future bearer presented by
// that client.
//
// Not exposed to the bearer surface — a paired client can't revoke
// itself or anyone else; only the signed-in web user can.

export const runtime = 'nodejs'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await revokeClientSession(id)
  return NextResponse.json({ success: true })
}
