import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, notes } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'
import { isGuideSlug } from '@/lib/dead-now-what-config'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role === 'readonly') {
    return Response.json({ error: 'Read-only access.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const noteId = typeof (body as { noteId?: unknown }).noteId === 'string' ? (body as { noteId: string }).noteId : ''
  const content = typeof (body as { content?: unknown }).content === 'string' ? (body as { content: string }).content : null

  if (!noteId || content === null) {
    return Response.json({ error: 'Missing note content.' }, { status: 400 })
  }

  const note = await db.select().from(notes).where(eq(notes.id, noteId)).then((rows) => rows[0])
  if (!note) return Response.json({ error: 'Note not found.' }, { status: 404 })
  if (note.isPrivate && session.user.role !== 'superuser') {
    return Response.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (note.isPersonal && note.createdBy !== session.user.id) {
    return Response.json({ error: 'Access denied.' }, { status: 403 })
  }

  const category = note.categoryId
    ? await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, note.categoryId)).then((rows) => rows[0])
    : null
  const isGuideNote = (category ? isGuideSlug(category.slug) : false) || (note.tags ?? []).some((tag) => tag.startsWith('now-what:'))
  if (!isGuideNote) {
    return Response.json({ error: 'This note is not part of the guide.' }, { status: 400 })
  }

  await db
    .update(notes)
    .set({
      content: content === '' ? '' : (encrypt(content) ?? ''),
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(notes.id, noteId))

  revalidatePath('/now-what')
  revalidatePath(`/notes/${noteId}`)
  revalidatePath('/notes')
  return Response.json({ success: true })
}
