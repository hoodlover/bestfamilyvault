import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, categories, noteFavorites } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { EditNoteForm } from '@/components/ui/edit-note-form'
import { decryptNote } from '@/lib/crypto'
import { getRecipeSubcategories } from '@/lib/actions/recipes'

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect(`/notes/${id}`)

  const rawNote = await db
    .select()
    .from(notes)
    .where(eq(notes.id, id))
    .then((r) => r[0])

  if (!rawNote) notFound()
  if (rawNote.isPrivate && session.user.role !== 'superuser') redirect('/dashboard')
  // isPersonal is strictly owner-only (superuser does not bypass).
  if (rawNote.isPersonal && rawNote.createdBy !== session.user.id) {
    redirect('/dashboard')
  }

  const note = decryptNote(rawNote)

  const allCategories = await db.select().from(categories).orderBy(categories.sortOrder)

  // If this note lives in the Recipes category, fetch its subcategory
  // list so the form can show the multi-select tag picker instead of
  // the (always-Recipes) category dropdown.
  const recipesCategory = allCategories.find((c) => c.slug === 'recipes')
  const isRecipe = !!recipesCategory && note.categoryId === recipesCategory.id
  const recipeSubcategories = isRecipe ? await getRecipeSubcategories() : []

  // Per-user favorite state — drives the Favorite checkbox default so each
  // family member sees their own star.
  const userFavorited = await db
    .select({ id: noteFavorites.id })
    .from(noteFavorites)
    .where(and(eq(noteFavorites.userId, session.user.id), eq(noteFavorites.noteId, id)))
    .then((r) => r.length > 0)

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/notes" className="hover:text-stone-300 transition">Notes</Link>
        <ChevronRight size={14} />
        <Link href={`/notes/${note.id}`} className="hover:text-stone-300 transition truncate max-w-[200px]">
          {note.title}
        </Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Edit</span>
      </nav>

      <h1 className="text-2xl font-bold text-stone-100 mb-2">
        {isRecipe ? 'Edit Recipe' : 'Edit Note'}
      </h1>
      <p className="text-stone-400 text-sm mb-8">Changes are saved immediately.</p>

      <EditNoteForm
        note={note}
        categories={allCategories}
        isSuperuser={session.user.role === 'superuser'}
        userFavorited={userFavorited}
        recipeSubcategories={recipeSubcategories}
        isRecipe={isRecipe}
      />
    </div>
  )
}
