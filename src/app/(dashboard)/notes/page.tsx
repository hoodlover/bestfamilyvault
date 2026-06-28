import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { eq, desc, and, or, ne, isNull } from 'drizzle-orm'
import { NotesBrowser } from '@/components/ui/notes-browser'
import { decryptNotes } from '@/lib/crypto'
import { getCategoryLabel } from '@/lib/category-presentation'
import { getAttachmentCountsByNote } from '@/lib/actions/entries'

export default async function NotesPage() {
  const session = await auth()
  const isSuperuser = session?.user?.role === 'superuser'
  const userId = session?.user?.id ?? ''

  // Recipes live in the notes table under the 'recipes' category — but
  // the Notes browser shouldn't surface them since /recipes is the
  // canonical place to browse those. Look up the recipes category id
  // once + exclude.
  const recipesCat = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'recipes'))
    .then((r) => r[0])
  const recipesCatId = recipesCat?.id ?? null

  const [allNotesRaw] = await Promise.all([
    db
      .select()
      .from(notes)
      .where(
        and(
          // isPersonal is owner-only — superuser does NOT bypass.
          or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
          // isPrivate is the Private Vault — superuser-only.
          isSuperuser ? undefined : eq(notes.isPrivate, false),
          // Filter out recipes — they have their own dedicated page.
          recipesCatId
            ? or(ne(notes.categoryId, recipesCatId), isNull(notes.categoryId))
            : undefined,
        )
      )
      .orderBy(desc(notes.updatedAt)),
  ])
  const allNotes = decryptNotes(allNotesRaw)

  // Category lookup → drives the per-card colored pill in the footer.
  // Single fetch; the in-memory map keeps NoteCard rendering O(1).
  const allCategories = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
  const categoriesById = Object.fromEntries(
    allCategories.map((c) => [c.id, { slug: c.slug, label: getCategoryLabel(c.slug, c.name) }]),
  )

  // Per-note attachment counts → drives the Paperclip chip on each
  // NoteCard. Converted to a plain Record so it serializes cleanly
  // through the server → client boundary into NotesBrowser.
  const noteAttachmentCountsMap = await getAttachmentCountsByNote(allNotes.map((n) => n.id))
  const attachmentCounts = Object.fromEntries(noteAttachmentCountsMap.entries())

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <NotesBrowser notes={allNotes} categoriesById={categoriesById} attachmentCounts={attachmentCounts} />
    </div>
  )
}
