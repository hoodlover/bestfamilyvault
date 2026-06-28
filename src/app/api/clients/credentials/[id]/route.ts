import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { encrypt, decrypt } from '@/lib/crypto'
import { requireClient } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'

// PATCH /api/clients/credentials/[id] — extension-driven password update.
// Used when the user types a new password on a site that already has a
// matching credential by domain+username. Replaces the previous silent-
// suppress behavior, which left users wondering why nothing happened.
//
// Body: { password: string }
// Updates ONLY the password field + passwordUpdatedAt stamp. Title,
// username, url, notes are left alone — the extension can't change those
// confidently from a single form submission.

export const runtime = 'nodejs'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const auth = await requireClient(req)
  if ('error' in auth) return auth.error

  const { id } = await ctx.params
  if (!id) return json({ error: 'Missing credential id.' }, { status: 400 })

  let body: { password?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const password = (body.password ?? '').toString()
  if (!password || password.length < 1) {
    return json({ error: 'password is required.' }, { status: 400 })
  }

  const existing = await db
    .select({
      id: entries.id,
      type: entries.type,
      password: entries.password,
      isPrivate: entries.isPrivate,
      isPersonal: entries.isPersonal,
      createdBy: entries.createdBy,
    })
    .from(entries)
    .where(eq(entries.id, id))
    .then((r) => r[0])

  if (!existing) return json({ error: 'Credential not found.' }, { status: 404 })
  if (existing.type !== 'login') return json({ error: 'Not a login credential.' }, { status: 400 })

  // Access guard: same rules as the vault UI. isPrivate is superuser-only,
  // isPersonal is owner-only. The extension session is a "user" session
  // bound via requireClient — but we don't have a role bit here; use the
  // simplest correct check: only the owner can update isPersonal entries,
  // and isPrivate entries require manual handling via the vault UI.
  if (existing.isPrivate) return json({ error: 'Private — update via the vault UI.' }, { status: 403 })
  if (existing.isPersonal && existing.createdBy !== auth.userId) {
    return json({ error: 'Personal entry belongs to someone else.' }, { status: 403 })
  }

  // No-op if the password is identical (don't burn a passwordUpdatedAt
  // stamp on a no-op call).
  if (decrypt(existing.password) === password) {
    return json({ ok: true, id, unchanged: true })
  }

  await db
    .update(entries)
    .set({
      password: encrypt(password),
      passwordUpdatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: auth.userId,
    })
    .where(eq(entries.id, id))

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')

  return json({ ok: true, id })
}
