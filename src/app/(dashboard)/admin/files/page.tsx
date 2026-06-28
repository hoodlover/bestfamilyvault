import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { files, notes, entries, categories, subcategories, users } from '@/lib/db/schema'
import { asc, desc, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { HelpPopout } from '@/components/ui/help-popout'
import {
  FilesAdminBrowser,
  type FileRow,
  type CategoryOption,
  type SubcategoryOption,
  type NoteOption,
  type EntryOption,
} from '@/components/ui/files-admin-browser'

export default async function AdminFilesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser') redirect('/admin')

  // Fetch every file, plus their parent labels in three batched queries to
  // avoid N+1. Then stitch the parent display strings together client-side.
  const [allFiles, allCats, allSubs, allUsers, allNotesList, allEntriesList] = await Promise.all([
    db.select().from(files).orderBy(desc(files.createdAt)),
    db.select().from(categories).orderBy(asc(categories.sortOrder)),
    db.select().from(subcategories).orderBy(asc(subcategories.sortOrder)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    // Lightweight notes list for the move-to-different-note picker. Only the
    // fields the picker needs — no decryption (titles aren't encrypted).
    db.select({
      id: notes.id,
      title: notes.title,
      categoryId: notes.categoryId,
      subcategoryId: notes.subcategoryId,
    }).from(notes).orderBy(desc(notes.updatedAt)),
    db.select({
      id: entries.id,
      title: entries.title,
      type: entries.type,
      categoryId: entries.categoryId,
      subcategoryId: entries.subcategoryId,
    }).from(entries).orderBy(desc(entries.updatedAt)),
  ])

  const noteIds = [...new Set(allFiles.map((f) => f.noteId).filter((x): x is string => !!x))]
  const entryIds = [...new Set(allFiles.map((f) => f.entryId).filter((x): x is string => !!x))]

  const [parentNotes, parentEntries] = await Promise.all([
    noteIds.length
      ? db.select({
          id: notes.id,
          title: notes.title,
          categoryId: notes.categoryId,
          subcategoryId: notes.subcategoryId,
        }).from(notes).where(inArray(notes.id, noteIds))
      : Promise.resolve([]),
    entryIds.length
      ? db.select({
          id: entries.id,
          title: entries.title,
          type: entries.type,
          categoryId: entries.categoryId,
          subcategoryId: entries.subcategoryId,
        }).from(entries).where(inArray(entries.id, entryIds))
      : Promise.resolve([]),
  ])

  const catById = new Map(allCats.map((c) => [c.id, c]))
  const subById = new Map(allSubs.map((s) => [s.id, s]))
  const noteById = new Map(parentNotes.map((n) => [n.id, n]))
  const entryById = new Map(parentEntries.map((e) => [e.id, e]))
  const userById = new Map(allUsers.map((u) => [u.id, u]))

  const rows: FileRow[] = allFiles.map((f) => {
    let kind: FileRow['kind'] = 'orphan'
    let parentTitle = '(unattached)'
    let parentHref: string | null = null
    let categoryId: string | null = null
    let subcategoryId: string | null = null

    if (f.noteId) {
      const n = noteById.get(f.noteId)
      if (n) {
        kind = 'note'
        parentTitle = n.title
        parentHref = `/notes/${n.id}`
        categoryId = n.categoryId
        subcategoryId = n.subcategoryId
      }
    } else if (f.entryId) {
      const e = entryById.get(f.entryId)
      if (e) {
        kind = 'entry'
        parentTitle = e.title
        parentHref = `/entries/${e.id}`
        categoryId = e.categoryId
        subcategoryId = e.subcategoryId
      }
    } else if (f.categoryId) {
      const c = catById.get(f.categoryId)
      if (c) {
        kind = 'category'
        parentTitle = c.name
        parentHref = `/categories/${c.slug}`
        categoryId = c.id
      }
    }

    const cat = categoryId ? catById.get(categoryId) : null
    const sub = subcategoryId ? subById.get(subcategoryId) : null
    const owner = userById.get(f.uploadedBy)

    return {
      id: f.id,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
      isPrivate: f.isPrivate,
      uploadedAt: f.createdAt.toISOString(),
      uploaderName: owner?.name ?? owner?.email ?? '—',
      kind,
      parentTitle,
      parentHref,
      categoryId,
      categoryName: cat?.name ?? null,
      subcategoryId,
      subcategoryName: sub?.name ?? null,
      downloadHref: `/api/files/${f.id}`,
    }
  })

  const categoryOptions: CategoryOption[] = allCats.map((c) => ({
    id: c.id,
    name: c.name,
  }))
  const subcategoryOptions: SubcategoryOption[] = allSubs.map((s) => ({
    id: s.id,
    name: s.name,
    categoryId: s.categoryId,
  }))
  const noteOptions: NoteOption[] = allNotesList.map((n) => ({
    id: n.id,
    title: n.title,
    categoryName: n.categoryId ? catById.get(n.categoryId)?.name ?? null : null,
    subcategoryName: n.subcategoryId ? subById.get(n.subcategoryId)?.name ?? null : null,
  }))
  const entryOptions: EntryOption[] = allEntriesList.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    categoryName: e.categoryId ? catById.get(e.categoryId)?.name ?? null : null,
  }))

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Files</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-100 flex items-center gap-2">
          Files
          <HelpPopout
            title="Files (admin)"
            sections={[
              {
                heading: 'What you see',
                tips: [
                  { title: 'Every file', description: 'All attachments across entries / notes / categories — including the bug-out import set.' },
                  { title: 'Per-file actions', description: 'Re-attach to a different note, reassign category, delete. Updates are immediate (no batch confirm).' },
                ],
              },
              {
                heading: 'Bulk ops',
                tips: [
                  { title: 'Multi-select + bulk delete', description: 'Tick multiple to delete a stack at once. Blob storage deletes happen server-side.' },
                  { title: 'Filenames are now date-stamped', description: 'New uploads auto-name as "<parent-title>-YYYY-MM-DD.ext". Existing legacy filenames can be renamed inline from any FileList.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-stone-400 text-sm mt-0.5">
          Every file in the vault, including the bug-out import. Reassign to a different
          category, attach to a different note, delete in bulk. Updates are immediate.
        </p>
      </div>

      <FilesAdminBrowser
        rows={rows}
        categories={categoryOptions}
        subcategories={subcategoryOptions}
        notes={noteOptions}
        entries={entryOptions}
      />
    </div>
  )
}
