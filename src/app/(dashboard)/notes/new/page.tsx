import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'
import { redirect } from 'next/navigation'
import { NewNoteForm } from '@/components/ui/new-note-form'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ isPrivate?: string; isPersonal?: string; categoryId?: string }>
}) {
  const { isPrivate, isPersonal, categoryId } = await searchParams
  const session = await auth()
  if (session?.user?.role === 'readonly') redirect('/notes')

  const [allCategories, allSubcategories] = await Promise.all([
    db.select().from(categories).orderBy(categories.sortOrder),
    db.select().from(subcategories).orderBy(subcategories.sortOrder),
  ])

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-stone-100 mb-2 flex items-center gap-2">
        <img src="/icons/cobb/icons/system/notes2.png" width={28} height={28} alt="" className="object-contain rounded" />
        New Note
        <HelpPopout
          title="New note"
          sections={[
            {
              heading: 'Write',
              tips: [
                { title: 'Rich text editor', description: 'Bold, italic, highlight, underline, links, bullet/numbered lists, checkboxes. Paste a URL — it becomes a clickable link on save.' },
                { title: 'Title-case on title', description: '"netflix login" saves as "Netflix Login" — happens on blur.' },
              ],
            },
            {
              heading: 'Categorize',
              tips: [
                { title: 'Category dropdown', description: 'Picks where the note lives. Pre-filled if you came from a category page.' },
                { title: 'Subcategory (when applicable)', description: 'Some categories have subs — shown as a second dropdown once you pick a parent.' },
                { title: 'Personal toggle', description: 'Tick to make this only-you-see-it. Lands on /my-vault, invisible to everyone else (even admins).' },
                { title: 'Private toggle', description: 'Superuser-only. Hides from non-superusers.' },
              ],
            },
            {
              heading: 'After save',
              tips: [
                { title: 'Attach files', description: 'Once saved, the detail page lets you drop attachments. Auto-named from title + date.' },
                { title: 'Edit anytime', description: 'Edit button on the detail page → same rich-text editor + autosave.' },
              ],
            },
          ]}
        />
      </h1>
      <p className="text-stone-400 text-sm mb-8">Write something worth keeping.</p>
      <NewNoteForm
        categories={allCategories}
        subcategories={allSubcategories}
        isSuperuser={session?.user?.role === 'superuser'}
        defaultIsPrivate={isPrivate === 'true'}
        defaultIsPersonal={isPersonal === 'true'}
        defaultCategoryId={categoryId}
      />
    </div>
  )
}
