import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { decryptNote } from '@/lib/crypto'
import { RecipeCookMode } from '@/components/ui/recipe-cook-mode'

// Full-screen cooking mode for a recipe. Renders <RecipeCookMode>
// which is fixed inset-0 z-[9999] — it sits above the dashboard
// chrome (sidebar, mobile-nav, avatar, etc.) and owns the viewport.

export default async function CookRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')

  const rawNote = await db.select().from(notes).where(eq(notes.id, id)).then((r) => r[0])
  if (!rawNote) notFound()
  if (rawNote.isPrivate && session.user.role !== 'superuser') redirect('/dashboard')
  if (rawNote.isPersonal && rawNote.createdBy !== session.user.id) redirect('/dashboard')

  // Must be a recipe — bounce back to the note page otherwise.
  if (!rawNote.categoryId) redirect(`/notes/${id}`)
  const cat = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, rawNote.categoryId))
    .then((r) => r[0])
  if (cat?.slug !== 'recipes') redirect(`/notes/${id}`)

  const note = decryptNote(rawNote)

  // Stable content hash for the localStorage cache key — short FNV-1a
  // is plenty to detect a content change without bringing in crypto.
  const contentHash = fnv1aHex(note.content ?? '')

  return <RecipeCookMode noteId={note.id} title={note.title} contentHash={contentHash} />
}

function fnv1aHex(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
