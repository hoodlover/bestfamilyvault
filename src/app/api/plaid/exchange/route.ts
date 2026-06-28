// Exchanges Plaid's short-lived public_token (returned by Link on
// successful auth) for a long-lived access_token, then saves the
// connection to the target entry. The client passes:
//   - public_token  : from the onSuccess Link callback
//   - entryId       : which vault entry to attach the link to
//   - accountId     : which Plaid account inside the Item to pin (the
//                     bank login can hold several; we mirror one entry
//                     to one account)
//
// On success, the entry's plaid_* columns are populated. The access
// token is encrypted before storage with the same envelope as
// account_number/card_number etc. (see ENTRY_ENCRYPTED_FIELDS).

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { plaid } from '@/lib/plaid'
import { encrypt } from '@/lib/crypto'

export const runtime = 'nodejs'

interface Body {
  public_token?: string
  entryId?: string
  accountId?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role === 'readonly') {
    return NextResponse.json({ error: 'Read-only access.' }, { status: 403 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { public_token, entryId, accountId } = body
  if (!public_token || !entryId || !accountId) {
    return NextResponse.json(
      { error: 'public_token, entryId, and accountId are required.' },
      { status: 400 },
    )
  }

  const entry = await db
    .select({
      id: entries.id,
      type: entries.type,
      isPrivate: entries.isPrivate,
      isPersonal: entries.isPersonal,
      createdBy: entries.createdBy,
    })
    .from(entries)
    .where(eq(entries.id, entryId))
    .then((r) => r[0])
  if (!entry) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })

  // Auth check — match the rest of the vault's visibility rules. We
  // do NOT allow superusers to bypass isPersonal (matches canAccess in
  // lib/actions/entries.ts).
  const isSuperuser = session.user.role === 'superuser'
  if (entry.isPrivate && !isSuperuser) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (entry.isPersonal && entry.createdBy !== session.user.id) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }

  // Sanity check — Plaid links only make sense for bank/credit entries.
  if (entry.type !== 'bank_account' && entry.type !== 'credit_card') {
    return NextResponse.json(
      { error: `Plaid linking only supports bank_account and credit_card entries (got ${entry.type}).` },
      { status: 400 },
    )
  }

  try {
    const exchange = await plaid().itemPublicTokenExchange({ public_token })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    const encrypted = encrypt(accessToken)
    if (!encrypted) {
      return NextResponse.json({ error: 'Failed to encrypt access token.' }, { status: 500 })
    }

    await db
      .update(entries)
      .set({
        plaidItemId: itemId,
        plaidAccessToken: encrypted,
        plaidAccountId: accountId,
        // Reset the cursor so the next sync pulls the historical baseline
        // for this account. Without this, an entry that's been linked +
        // unlinked + re-linked would skip everything before the previous
        // cursor.
        plaidCursor: null,
        plaidSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(entries.id, entryId))

    return NextResponse.json({ ok: true, itemId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plaid/exchange] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
