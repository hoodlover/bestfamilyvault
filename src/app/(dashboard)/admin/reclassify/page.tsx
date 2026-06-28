import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories, entries } from '@/lib/db/schema'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { EntryGrid } from '@/components/ui/entry-grid'
import { HelpPopout } from '@/components/ui/help-popout'
import { CobbBanner } from '@/components/ui/cobb-banner'
import { getCategoryLabel } from '@/lib/category-presentation'
import { decryptEntries } from '@/lib/crypto'

export default async function ReclassifyPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') redirect('/dashboard')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  const [allCategories, allSubcategories, allEntriesRaw] = await Promise.all([
    db.select().from(categories).orderBy(categories.sortOrder),
    db.select().from(subcategories).orderBy(subcategories.sortOrder),
    db
      .select()
      .from(entries)
      .where(
        and(
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          // isPersonal is owner-only — superuser does NOT bypass.
          or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
          isNull(entries.parentEntryId)
        )
      )
      .orderBy(desc(entries.updatedAt)),
  ])
  const allEntries = decryptEntries(allEntriesRaw)

  const parentIds = allEntries.map((entry) => entry.id)
  const childEntries = parentIds.length > 0
    ? decryptEntries(await db.select().from(entries).where(inArray(entries.parentEntryId, parentIds)))
    : []

  const childrenMap: Record<string, typeof childEntries> = {}
  for (const child of childEntries) {
    if (!child.parentEntryId) continue
    if (!childrenMap[child.parentEntryId]) childrenMap[child.parentEntryId] = []
    childrenMap[child.parentEntryId].push(child)
  }

  const subMap = Object.fromEntries(allSubcategories.map((s) => [s.id, s.name]))

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <CobbBanner compact />
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Mass Reclassify</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-100 flex items-center gap-2">
          Mass Reclassify
          <HelpPopout
            title="Mass Reclassify"
            sections={[
              {
                heading: 'When you\'d use this',
                tips: [
                  { title: 'Bulk move', description: 'After a category rename / split, walk through entries and re-file them to the new home without opening each one.' },
                  { title: 'Subcategory cleanup', description: 'Same flow for subs — useful after pruning the canonical recipe-subcat list.' },
                ],
              },
              {
                heading: 'How it works',
                tips: [
                  { title: 'Select entries', description: 'Tick rows. Filter by category at the top to narrow what shows.' },
                  { title: 'Pick destination', description: 'Choose target category + (optional) subcategory.' },
                  { title: 'Apply', description: 'Updates atomically; the destination page reflects them next time you visit.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-sm text-stone-400 mt-1">
          Select entries, choose a new category or subcategory, then move them together.
        </p>
      </div>

      <EntryGrid
        entries={allEntries}
        childrenMap={childrenMap}
        allCategories={allCategories}
        allSubcategories={allSubcategories}
        categoryName="Vault"
        subMap={subMap}
        canEdit
        categoryId={allCategories[0]?.id ?? ''}
        newEntryHref="/entries/new"
        categoryLabelById={Object.fromEntries(allCategories.map((c) => [c.id, getCategoryLabel(c.slug, c.name)]))}
      />
    </div>
  )
}
