import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, entries, notes } from '@/lib/db/schema'
import { decrypt, encrypt } from '@/lib/crypto'
import { guideRouteForSlug, isGuideSlug } from '@/lib/dead-now-what-config'
import { titleCaseWords } from '@/lib/title-case'

type CardKind = 'note' | 'password'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role === 'readonly') {
    return Response.json({ error: 'Read-only access.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const noteId = typeof body.noteId === 'string' ? body.noteId : ''
  const start = typeof body.start === 'number' ? body.start : -1
  const end = typeof body.end === 'number' ? body.end : -1
  const cardKind = body.cardKind === 'password' ? 'password' : 'note'
  const title = titleCaseWords(typeof body.title === 'string' ? body.title : '')
  const detail = typeof body.detail === 'string' ? body.detail.trim() : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  // Optional pre-picked vault cards. The wizard's "Link existing" panel
  // is multi-select; if the user had cards queued there before clicking
  // "Create, link, and next" we splice them in too so they aren't
  // silently dropped. Validated shape: short strings only, internal
  // hrefs only (no http(s) past the path), no markdown control chars.
  const linkedCards = parseLinkedCards(body.linkedCards)

  if (!noteId || start < 0 || end <= start) {
    return Response.json({ error: 'Missing guide location.' }, { status: 400 })
  }
  if (!title) {
    return Response.json({ error: 'Add a title for the new card.' }, { status: 400 })
  }

  const guideNote = await db.select().from(notes).where(eq(notes.id, noteId)).then((rows) => rows[0])
  if (!guideNote) return Response.json({ error: 'Guide note not found.' }, { status: 404 })
  if (guideNote.isPrivate && session.user.role !== 'superuser') {
    return Response.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (guideNote.isPersonal && guideNote.createdBy !== session.user.id) {
    return Response.json({ error: 'Access denied.' }, { status: 403 })
  }

  const guideCategory = guideNote.categoryId
    ? await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, guideNote.categoryId)).then((rows) => rows[0])
    : null
  const guideSlug = guideCategory?.slug ?? null
  const isGuideNote = (guideSlug ? isGuideSlug(guideSlug) : false) || (guideNote.tags ?? []).some((tag) => tag.startsWith('now-what:'))
  if (!isGuideNote) {
    return Response.json({ error: 'This note is not part of the guide.' }, { status: 400 })
  }

  const currentContent = guideNote.content === '' ? '' : (decrypt(guideNote.content) ?? '')
  if (!/^_{3,}$/.test(currentContent.slice(start, end))) {
    return Response.json({ error: 'That blank changed. Refresh and try again.' }, { status: 409 })
  }

  let card: Awaited<ReturnType<typeof createCard>>
  try {
    card = await createCard(cardKind, {
      title,
      detail,
      username,
      password,
      url,
      userId: session.user.id,
      categoryId: guideNote.categoryId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the card.'
    return Response.json({ error: message }, { status: 500 })
  }
  // Markdown link form so LinkifiedText renders the title as the visible
  // text and hides the raw /entries/<uuid> behind the href. Was
  // `${card.title}: ${card.href}` which dumped the URL into the answer
  // text and looked off on the IDNW detail page. When the wizard also
  // sent pre-picked linked cards, they get appended comma-separated.
  const allLinks = [
    `[${card.title}](${card.href})`,
    ...linkedCards.map((c) => `[${c.title}](${c.href})`),
  ]
  const answer = allLinks.join(', ')
  const nextContent = currentContent.slice(0, start) + answer + currentContent.slice(end)

  await db
    .update(notes)
    .set({
      content: nextContent === '' ? '' : (encrypt(nextContent) ?? ''),
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, noteId))

  revalidatePath(guideSlug ? (guideRouteForSlug(guideSlug) ?? '/now-what') : '/now-what')
  revalidatePath(`/notes/${noteId}`)
  revalidatePath(card.href)
  revalidatePath('/dashboard')
  revalidatePath('/notes')
  return Response.json({ success: true, answer, content: nextContent, card })
}

async function createCard(
  cardKind: CardKind,
  fields: {
    title: string
    detail: string
    username: string
    password: string
    url: string
    userId: string
    categoryId: string | null
  }
) {
  if (cardKind === 'note') {
    const [note] = await db
      .insert(notes)
      .values({
        categoryId: fields.categoryId,
        subcategoryId: null,
        title: fields.title,
        content: fields.detail === '' ? '' : (encrypt(fields.detail) ?? ''),
        isFavorite: false,
        isPrivate: false,
        isPersonal: false,
        createdBy: fields.userId,
        updatedBy: fields.userId,
      })
      .returning({ id: notes.id, title: notes.title })
    return { id: note.id, title: note.title, href: `/notes/${note.id}`, kind: 'Note' }
  }

  const categoryId = fields.categoryId ?? await findPasswordCategoryId()
  if (!categoryId) {
    throw new Error('No category is available for the new password card.')
  }

  const [entry] = await db
    .insert(entries)
    .values({
      categoryId,
      subcategoryId: null,
      type: 'login',
      title: fields.title,
      username: fields.username || null,
      password: encrypt(fields.password || null),
      url: fields.url || null,
      noteContent: encrypt(fields.detail || null),
      isFavorite: false,
      isPrivate: false,
      isPersonal: false,
      createdBy: fields.userId,
      updatedBy: fields.userId,
    })
    .returning({ id: entries.id, title: entries.title })
  return { id: entry.id, title: entry.title, href: `/entries/${entry.id}`, kind: 'Password' }
}

// Whitelist the linkedCards payload from the wizard. Each card must be
// a short title and an internal /<route>/<id> path — we reject http(s)
// or anything with markdown control chars so a malformed client can't
// inject a different-looking link into the saved guide content.
function parseLinkedCards(input: unknown): { title: string; href: string }[] {
  if (!Array.isArray(input)) return []
  const out: { title: string; href: string }[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const obj = item as { title?: unknown; href?: unknown }
    const title = typeof obj.title === 'string' ? obj.title.trim() : ''
    const href = typeof obj.href === 'string' ? obj.href.trim() : ''
    if (!title || title.length > 200) continue
    if (!href || href.length > 400) continue
    if (!href.startsWith('/')) continue
    if (/[\[\]\(\)\n\r]/.test(title)) continue
    if (/[\s\(\)<>]/.test(href)) continue
    out.push({ title, href })
    if (out.length >= 20) break
  }
  return out
}

async function findPasswordCategoryId(): Promise<string | null> {
  const allCategories = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .orderBy(asc(categories.sortOrder))

  const available = allCategories.filter((category) => !isGuideSlug(category.slug))
  const preferredSlugs = ['tech', 'digital', 'business', 'home', 'money']
  return preferredSlugs
    .map((slug) => available.find((category) => category.slug === slug)?.id)
    .find(Boolean) ?? available[0]?.id ?? null
}
