// Server component — fetches files imported in the last 30 days and
// hands them to a client child that handles the "NEW" badge state via
// localStorage. Surfaces on /import so Lance can see what the
// auto-importer + scheduled task brought in overnight without having
// to dig through every category.

import { and, desc, eq, gte, isNotNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { files, entries, notes } from '@/lib/db/schema'
import { RecentlyImportedCards } from './recently-imported-cards'

const DAYS = 30
const MAX_ROWS = 80

export async function RecentlyImportedSection({ userId }: { userId: string }) {
  const since = new Date()
  since.setDate(since.getDate() - DAYS)

  // Files uploaded by this user in the window — joined to entry/note for
  // a label and a click-through target. createdAt + uploadedBy on file
  // is the canonical "when did this land" signal (import-inbox sets it).
  const rows = await db
    .select({
      id: files.id,
      filename: files.filename,
      contentType: files.contentType,
      size: files.size,
      createdAt: files.createdAt,
      entryId: files.entryId,
      noteId: files.noteId,
      entryTitle: entries.title,
      noteTitle: notes.title,
    })
    .from(files)
    .leftJoin(entries, eq(entries.id, files.entryId))
    .leftJoin(notes, eq(notes.id, files.noteId))
    .where(
      and(
        eq(files.uploadedBy, userId),
        gte(files.createdAt, since),
        // Skip avatar uploads + the like that have no parent — keeps
        // the list focused on real document imports.
        or(isNotNull(files.entryId), isNotNull(files.noteId)),
      ),
    )
    .orderBy(desc(files.createdAt))
    .limit(MAX_ROWS)

  if (rows.length === 0) return null

  const items = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    contentType: r.contentType,
    size: r.size,
    createdAtIso: r.createdAt.toISOString(),
    parentHref: r.entryId
      ? `/entries/${r.entryId}`
      : r.noteId
        ? `/notes/${r.noteId}`
        : null,
    parentTitle: r.entryTitle ?? r.noteTitle ?? '(unknown)',
  }))

  return <RecentlyImportedCards items={items} days={DAYS} />
}
