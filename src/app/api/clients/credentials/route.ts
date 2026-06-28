import { NextResponse, type NextRequest } from 'next/server'
import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { categories, entries } from '@/lib/db/schema'
import { decryptEntries, encrypt } from '@/lib/crypto'
import { requireClient } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'
import { extractRegistrableDomain } from '@/lib/clients/domain'

// The actual autofill endpoint. Called by extension/mobile clients to
// answer "what credentials does the user have for <domain>?". We pull
// every login-type entry the user can see, decrypt server-side, then
// filter by registrable-domain match in JS.
//
// Why filter in JS instead of SQL: entry.url is plaintext but we'd
// need eTLD+1 normalization to do the match server-side, and SQL can't
// run the Public Suffix List. The total entry count for a single
// family member is small enough that loading them all and filtering
// client-side here is fine. (The vault has ~200-500 entries total.)
//
// Returns ONLY the fields the autofill needs — title, username,
// password, url. Notes and other type-specific fields stay server-side.

export const runtime = 'nodejs'

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function GET(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const ctx = await requireClient(req)
  if ('error' in ctx) return ctx.error

  const url = new URL(req.url)
  const rawDomain = url.searchParams.get('domain') ?? ''
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const target = extractRegistrableDomain(rawDomain)
  // Either a domain match or a free-text search must be present —
  // otherwise we'd dump every login back to the client, which is
  // worth refusing.
  if (!target && !q) {
    return json({ credentials: [] })
  }

  // Pull every login entry the user can see (their own personal +
  // shared family stuff). Skip entries with no URL only when matching
  // by domain — search results don't require one. canAccess equivalent
  // in SQL: isPersonal=false OR createdBy=userId.
  //
  // Merged groups: we INCLUDE BOTH the parent AND its children. After a
  // merge the parent carries its own "winner" username/password (the
  // values that won the slot-0 contest) while each child preserves its
  // original credentials. Both are distinct fillable options for the
  // user — pre-v281 we hid the parent on the assumption the children
  // already covered everything, but Lance pointed out that hid the
  // very credential he picked as the master and left only the kid
  // visible. If a parent's password genuinely duplicates a child's,
  // the user just sees two rows with the same dots — minor cost
  // compared to losing the master from the picker entirely.
  const raw = await db
    .select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      username: entries.username,
      password: entries.password,
      url: entries.url,
      isPrivate: entries.isPrivate,
      parentEntryId: entries.parentEntryId,
      autofillOnLoad: entries.autofillOnLoad,
    })
    .from(entries)
    .where(
      and(
        eq(entries.type, 'login'),
        target ? isNotNull(entries.url) : undefined,
        or(eq(entries.isPersonal, false), eq(entries.createdBy, ctx.userId)),
      ),
    )

  let matches = decryptEntries(raw)
  if (target) {
    matches = matches.filter((e) => extractRegistrableDomain(e.url) === target)
  }
  if (q) {
    matches = matches.filter((e) => {
      const blob = `${e.title ?? ''} ${e.username ?? ''} ${e.url ?? ''}`.toLowerCase()
      return blob.includes(q)
    })
  }
  // Drop entries without a usable password — they can't fill anything
  // and would just clutter the extension's picker. Title/username/URL
  // alone aren't useful when the whole point of the popup is to type
  // the password into the form. Lance hit this on sites where he'd
  // saved the username but never the actual password.
  matches = matches.filter((e) => typeof e.password === 'string' && e.password.trim() !== '')

  return json({
    domain: target,
    credentials: matches.map((e) => ({
      id: e.id,
      title: e.title,
      username: e.username,
      password: e.password,
      url: e.url,
      autofillOnLoad: e.autofillOnLoad ?? false,
    })),
  })
}

// Save-new-password flow from the extension. The user typed a fresh
// password into a website's signup/login form; we offer to capture it.
// We pick a sensible default category (the one this user already keeps
// the most logins under, falling back to any category that contains a
// login, falling back to the first category in the table). The user can
// re-categorize from the vault UI later.
//
// Body: { title, username, password, url }
export async function POST(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const ctx = await requireClient(req)
  if ('error' in ctx) return ctx.error

  let body: { title?: string; username?: string | null; password?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const title = (body.title ?? '').trim().slice(0, 200)
  const password = (body.password ?? '').trim()
  const url = (body.url ?? '').trim() || null
  const username = (body.username ?? '')?.toString().trim() || null
  if (!title || !password) {
    return json({ error: 'title and password are required.' }, { status: 400 })
  }

  // Default category: most-used login category for THIS user; else any
  // category currently holding a login; else first category overall.
  const mineByCount = await db
    .select({ categoryId: entries.categoryId, n: sql<number>`count(*)`.as('n') })
    .from(entries)
    .where(and(eq(entries.type, 'login'), eq(entries.createdBy, ctx.userId)))
    .groupBy(entries.categoryId)
    .orderBy(desc(sql`count(*)`))
    .limit(1)
  let categoryId: string | null = mineByCount[0]?.categoryId ?? null
  if (!categoryId) {
    const anyLogin = await db
      .select({ categoryId: entries.categoryId })
      .from(entries)
      .where(eq(entries.type, 'login'))
      .limit(1)
    categoryId = anyLogin[0]?.categoryId ?? null
  }
  if (!categoryId) {
    const anyCat = await db.select({ id: categories.id }).from(categories).limit(1)
    categoryId = anyCat[0]?.id ?? null
  }
  if (!categoryId) {
    return json({ error: 'No category available to save under.' }, { status: 500 })
  }

  const [entry] = await db
    .insert(entries)
    .values({
      categoryId,
      type: 'login',
      title,
      username,
      password: encrypt(password),
      passwordUpdatedAt: new Date(),
      url,
      isFavorite: false,
      isPrivate: false,
      isPersonal: true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning({ id: entries.id })

  revalidatePath('/dashboard')
  revalidatePath('/my-vault')

  return json({ ok: true, id: entry.id })
}
