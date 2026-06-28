import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, notes, categories } from '@/lib/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { HelpPopout } from '@/components/ui/help-popout'
import { EntryCard } from '@/components/ui/entry-card'
import { NoteCard } from '@/components/ui/note-card'
import { decryptEntries, decryptNotes } from '@/lib/crypto'
import { getAttachmentCountsByEntry, getAttachmentCountsByNote } from '@/lib/actions/entries'

export default async function PrivateVaultPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser') redirect('/dashboard')

  const [privateEntriesRaw, privateNotesRaw, allCategories] = await Promise.all([
    db
      .select()
      .from(entries)
      .where(eq(entries.isPrivate, true))
      .orderBy(desc(entries.updatedAt)),
    db
      .select()
      .from(notes)
      .where(eq(notes.isPrivate, true))
      .orderBy(desc(notes.updatedAt)),
    db.select().from(categories),
  ])

  const privateEntries = decryptEntries(privateEntriesRaw)
  const privateNotes = decryptNotes(privateNotesRaw)

  const catMap = Object.fromEntries(allCategories.map((c) => [c.id, c.name]))

  // Per-entry + per-note attachment counts — one batched query each
  // feeds the paperclip chip on every card on this page.
  const [attachmentCounts, noteAttachmentCounts] = await Promise.all([
    getAttachmentCountsByEntry(privateEntries.map((e) => e.id)),
    getAttachmentCountsByNote(privateNotes.map((n) => n.id)),
  ])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center mb-8">
        <div className="flex items-center gap-3">
          <img src="/icons/cobb/icons/system/admin_vault2.png" width={48} height={48} alt="" className="block h-12 w-12 object-contain shrink-0 rounded-xl" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">Admin Vault</h1>
              <HelpPopout
                title="Admin Vault"
                sections={[
                  {
                    heading: 'What\'s in here',
                    tips: [
                      { title: 'Everything', description: 'Every entry / note in the family vault, including Private ones non-superusers can\'t see. Use this when you need a global view.' },
                      { title: 'Across categories', description: 'Mixed view sorted by recency — not filtered by category like the regular browse pages.' },
                    ],
                  },
                  {
                    heading: 'Power moves',
                    tips: [
                      { title: 'Bulk operations', description: 'Some lists support selection / merge / move (look for the select toggle in the entry list).' },
                      { title: 'Other admin tools', description: '/admin has audit, files browser, legacy data inspector, merge candidates, reclassify wizard.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-stone-400 text-sm mt-0.5">Visible only to superusers.</p>
          </div>
        </div>
      </div>

      {/* Private Entries */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
          Private Entries ({privateEntries.length})
        </h2>
        {privateEntries.length === 0 ? (
          <div className="text-center py-12 text-stone-500 border border-stone-800 rounded-xl">
            <p className="text-3xl mb-3">🔐</p>
            <p className="text-sm">No private entries yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {privateEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                categoryName={catMap[entry.categoryId]}
                canEdit
                attachmentCount={attachmentCounts.get(entry.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Private Notes */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
          Private Notes ({privateNotes.length})
        </h2>
        {privateNotes.length === 0 ? (
          <div className="text-center py-12 text-stone-500 border border-stone-800 rounded-xl">
            <img src="/icons/cobb/privatevault.png" width={48} height={48} alt="" className="object-contain mx-auto mb-3 rounded" />
            <p className="text-sm">No private notes yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {privateNotes.map((note) => (
              <NoteCard key={note.id} note={note} attachmentCount={noteAttachmentCounts.get(note.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
