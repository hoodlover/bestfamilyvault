import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, notes, categories } from '@/lib/db/schema'
import { eq, and, desc, inArray, or, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { EntryCard } from '@/components/ui/entry-card'
import { HelpPopout } from '@/components/ui/help-popout'
import { NoteCard } from '@/components/ui/note-card'
import { AilencodeCredit } from '@/components/ui/cobb-banner'
import { decryptEntries, decryptNotes } from '@/lib/crypto'
import { getMyEntryFavoriteIds, getMyNoteFavoriteIds } from '@/lib/actions/favorites'
import { getAttachmentCountsByEntry, getAttachmentCountsByNote } from '@/lib/actions/entries'
import { getParentRecipients, OWNER } from '@/lib/family-config'
import { recipientSlugForUserName } from '@/lib/letters-recipients'
import { LetterToParentsPanel } from '@/components/ui/letter-to-parents-panel'

export default async function MyVaultPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  const allCategories = await db.select().from(categories)
  const catMap = Object.fromEntries(allCategories.map((c) => [c.id, c.name]))

  // Personal items are strictly owner-only — even superusers see only their
  // own. The previous "view other family members' personal stuff as superuser"
  // panel was removed when isPersonal became truly private.
  // Favorited items are per-user too, so they show up here alongside the
  // personal ones — Lance's stars don't bleed into Heather's vault and
  // vice versa.
  const [favEntryIdSet, favNoteIdSet] = await Promise.all([
    getMyEntryFavoriteIds(userId),
    getMyNoteFavoriteIds(userId),
  ])
  const favEntryIds = [...favEntryIdSet]
  const favNoteIds = [...favNoteIdSet]

  const [myEntriesRaw, myNotesRaw, favEntriesRaw, favNotesRaw] = await Promise.all([
    db.select().from(entries)
      .where(and(eq(entries.isPersonal, true), eq(entries.createdBy, userId)))
      .orderBy(desc(entries.updatedAt)),
    db.select().from(notes)
      .where(and(eq(notes.isPersonal, true), eq(notes.createdBy, userId)))
      .orderBy(desc(notes.updatedAt)),
    favEntryIds.length === 0
      ? Promise.resolve([])
      : db.select().from(entries).where(and(
          inArray(entries.id, favEntryIds),
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
          isNull(entries.parentEntryId),
        )).orderBy(desc(entries.updatedAt)),
    favNoteIds.length === 0
      ? Promise.resolve([])
      : db.select().from(notes).where(and(
          inArray(notes.id, favNoteIds),
          isSuperuser ? undefined : eq(notes.isPrivate, false),
          or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
        )).orderBy(desc(notes.updatedAt)),
  ])
  const myEntries = decryptEntries(myEntriesRaw)
  const myNotes = decryptNotes(myNotesRaw)
  const favEntries = decryptEntries(favEntriesRaw)
  const favNotes = decryptNotes(favNotesRaw)

  // Single batched query for the attachment-count chip on every card
  // rendered on this page. Personal + favorite entries / notes share
  // one lookup per parent type so we don't run multiple file scans.
  const allEntryIds = [...myEntries.map((e) => e.id), ...favEntries.map((e) => e.id)]
  const allNoteIds = [...myNotes.map((n) => n.id), ...favNotes.map((n) => n.id)]
  const [attachmentCounts, noteAttachmentCounts] = await Promise.all([
    getAttachmentCountsByEntry(allEntryIds),
    getAttachmentCountsByNote(allNoteIds),
  ])

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center mb-8">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/lockvault.png"
            alt=""
            width={48}
            height={48}
            className="block h-12 w-12 object-contain shrink-0 rounded-xl"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">My Vault</h1>
              <HelpPopout
                title="My Vault"
                sections={[
                  {
                    heading: 'What is this',
                    tips: [
                      { title: 'Personal-only items', description: 'Anything you marked "Personal" on creation. Other family members can\'t see these even if they\'re admins — it\'s your private corner.' },
                      { title: 'Letters to parents', description: 'Compose a letter to Mom or Dad here. They unlock for the recipient when the moment\'s right.' },
                    ],
                  },
                  {
                    heading: 'Add personal items',
                    tips: [
                      { title: 'New entry / note / photo', description: 'Use the regular create flows and tick "Personal" on the form — that\'s what makes it land here instead of the shared vault.' },
                      { title: 'Move existing items', description: 'On any entry / note, edit and toggle the Personal checkbox to migrate it here.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">Personal entries only you can see.</p>
          </div>
        </div>
      </div>

      {/* "Write a letter to Mom or Dad" — surfaces a compose flow per
          family member. Owner (Lance) gets composers for every parent
          AND every kid; non-owners get composers for parents only.
          Recipients see the letter; nobody else (privacy partition). */}
      {(() => {
        const userEmail = (session.user.email ?? '').toLowerCase()
        const parents = getParentRecipients()
        const myParent = parents.find((p) => p.emails.some((e) => e.toLowerCase() === userEmail))
        // Each user's slug = either their parent-slot slug, or the
        // letter-recipient slug derived from their display name (kid).
        const mySlug = myParent?.slug ?? recipientSlugForUserName(session.user.name)
        const firstName = (session.user.name ?? '').split(/\s+/)[0] || 'You'
        return (
          <LetterToParentsPanel
            parents={parents.map(({ slug, display }) => ({ slug, display }))}
            mySlug={mySlug}
            myDisplayName={firstName}
          />
        )
      })()}

      {/* My personal entries */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
          My Entries ({myEntries.length})
        </h2>
        {myEntries.length === 0 ? (
          <div className="text-center py-10 text-stone-500 border border-stone-800 rounded-xl">
            <p className="text-sm">No personal entries yet.</p>
            <Link href="/entries/new?isPersonal=true" className="mt-2 inline-block text-amber-400 hover:text-amber-300 text-sm transition">
              + Create personal entry
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            {myEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                categoryName={catMap[entry.categoryId]}
                canEdit
                isFavoriteOverride={favEntryIdSet.has(entry.id)}
                attachmentCount={attachmentCounts.get(entry.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* My personal notes */}
      {myNotes.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
            My Notes ({myNotes.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {myNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                isFavoriteOverride={favNoteIdSet.has(note.id)}
                attachmentCount={noteAttachmentCounts.get(note.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* My favorited entries — these came from anywhere in the vault but
          this user starred them, so they live in their personal home too. */}
      {favEntries.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Star size={13} className="text-emerald-400 fill-emerald-400" />
            Favorites ({favEntries.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            {favEntries.map((entry) => (
              <EntryCard
                key={`fav-${entry.id}`}
                entry={entry}
                categoryName={catMap[entry.categoryId]}
                canEdit
                isFavoriteOverride
                attachmentCount={attachmentCounts.get(entry.id)}
              />
            ))}
          </div>
        </section>
      )}

      {favNotes.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Star size={13} className="text-emerald-400 fill-emerald-400" />
            Favorite Notes ({favNotes.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {favNotes.map((note) => (
              <NoteCard
                key={`fav-${note.id}`}
                note={note}
                isFavoriteOverride
                attachmentCount={noteAttachmentCounts.get(note.id)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mt-12 flex justify-center opacity-50">
        <AilencodeCredit size="lg" />
      </div>
    </div>
  )
}
