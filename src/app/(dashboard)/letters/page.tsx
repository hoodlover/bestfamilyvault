import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { letters, letterRelease } from '@/lib/db/schema'
import { and, desc, eq, sql, type InferSelectModel } from 'drizzle-orm'
import { LettersUI } from '@/components/ui/letters-ui'
import { HelpPopout } from '@/components/ui/help-popout'
import { LETTER_RECIPIENTS, recipientSlugForUserName } from '@/lib/letters-recipients'
import { decryptLetters } from '@/lib/crypto'
import { getParentRecipients } from '@/lib/family-config'

type LetterRow = InferSelectModel<typeof letters>

export const dynamic = 'force-dynamic'

export default async function LettersPage() {
  const session = await auth()
  const isSuperuser = session?.user?.role === 'superuser'
  const myRecipientSlug = recipientSlugForUserName(session?.user?.name ?? null)
  const userId = session?.user?.id ?? ''
  const userEmail = (session?.user?.email ?? '').toLowerCase()

  // Release gate: while no row has `releasedAt` in the past, ONLY the
  // superuser can read 'gift' content — even Heather is locked out until
  // Lance is gone. Singleton row.
  const releaseRow = await db.select().from(letterRelease).limit(1).then((r) => r[0])
  const now = new Date()
  const isReleased = releaseRow?.releasedAt != null && releaseRow.releasedAt <= now

  // Resolve which (if any) parent slot the current user owns. Used to
  // surface the kid-to-parent inbox card to the right person.
  const parentRecipients = getParentRecipients()
  const myParentSlot = parentRecipients.find((p) =>
    p.emails.some((e) => e.toLowerCase() === userEmail),
  ) ?? null

  // ─── 'gift' letters (parent → kid) — original release-gated flow ──
  const giftRows = isSuperuser
    ? await db.select().from(letters).where(eq(letters.direction, 'gift')).orderBy(desc(letters.createdAt))
    : isReleased && myRecipientSlug
      ? await db
          .select()
          .from(letters)
          .where(and(eq(letters.direction, 'gift'), eq(letters.recipientName, myRecipientSlug)))
          .orderBy(desc(letters.createdAt))
      : []

  // ─── 'note-to' letters (kid → parent) — privacy-partitioned ──
  // Only the AUTHOR (sender) and the named PARENT recipient see them.
  // Other family members never see them, INCLUDING the superuser
  // (privacy partition is intentional — Lance can't see Heather's
  // inbox even though he's superuser).
  let noteToRows: LetterRow[] = []
  if (myParentSlot) {
    // I am a parent — pull all letters addressed to my slot.
    noteToRows = await db
      .select()
      .from(letters)
      .where(and(eq(letters.direction, 'note-to'), eq(letters.recipientName, myParentSlot.slug)))
      .orderBy(desc(letters.createdAt))
  }
  // Also pull anything the current user authored, so they can see what
  // they sent (the recipient parent might also see it via the query above).
  if (userId) {
    const mySent = await db
      .select()
      .from(letters)
      .where(and(eq(letters.direction, 'note-to'), eq(letters.createdBy, userId)))
      .orderBy(desc(letters.createdAt))
    // Merge by id, no duplicates.
    const seen = new Set(noteToRows.map((r) => r.id))
    for (const row of mySent) if (!seen.has(row.id)) noteToRows.push(row)
  }

  const visibleLetters = decryptLetters([...giftRows, ...noteToRows])
  // The UI component handles the unlock-at gate per row (so authors and
  // superusers see content; recipients see a "🔒 unlocks YYYY-MM-DD"
  // placeholder until then). We pass the raw unlockAt + createdBy
  // through so the client can compare against the current viewer.
  const visibleLettersWithLocks = visibleLetters

  // Counts per recipient (gift letters only — for the locked sibling cards).
  const countRows = await db
    .select({
      recipientName: letters.recipientName,
      count: sql<number>`count(*)::int`,
    })
    .from(letters)
    .where(eq(letters.direction, 'gift'))
    .groupBy(letters.recipientName)

  const countByRecipient: Record<string, number> = {}
  for (const r of countRows) countByRecipient[r.recipientName] = Number(r.count)

  // Group letters: 'gift' by recipient slug; 'note-to' separately by parent slug.
  const lettersByRecipient: Record<string, typeof visibleLettersWithLocks> = {}
  const noteToByParent: Record<string, typeof visibleLettersWithLocks> = {}
  for (const l of visibleLettersWithLocks) {
    if (l.direction === 'gift') {
      if (!lettersByRecipient[l.recipientName]) lettersByRecipient[l.recipientName] = []
      lettersByRecipient[l.recipientName].push(l)
    } else {
      if (!noteToByParent[l.recipientName]) noteToByParent[l.recipientName] = []
      noteToByParent[l.recipientName].push(l)
    }
  }

  return (
    <div className="relative min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      {/* Atmospheric background — dark blue/violet gradient with vignette */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top, #1e1b4b 0%, #0a0a0a 45%, #000 100%)',
        }}
      />

      <div className="flex items-center justify-between mb-6"></div>

      <header className="text-center mb-10 md:mb-14">
        <h1 className="text-3xl md:text-5xl font-serif font-bold tracking-tight text-stone-50 drop-shadow-[0_0_18px_rgba(168,85,247,0.25)]">
          Family Letters
        </h1>
        <div className="mt-2 flex justify-center">
          <HelpPopout
            title="Family Letters"
            sections={[
              {
                heading: 'For the kids',
                tips: [
                  { title: 'See letters addressed to you', description: 'Tabs / sections show letters Dad wrote specifically for you, by name. They unlock when the moment is right (date or master password).' },
                  { title: 'Audio + video', description: 'Some letters are recordings — tap to play, full transcript may also be there.' },
                ],
              },
              {
                heading: 'For Dad / admin',
                tips: [
                  { title: 'Compose new letter', description: 'Write a letter to a specific child (or to "all"). Can be text, audio recording, or video.' },
                  { title: 'Unlock conditions', description: 'Date-based release (e.g. 18th birthday) or master-password gated. Set on creation; editable later.' },
                  { title: 'Attachments', description: 'Drop in photos, certificates, anything else worth keeping with the letter.' },
                ],
              },
              {
                heading: 'How it stays safe',
                tips: [
                  { title: 'Encrypted at rest', description: 'Letter bodies are encrypted in the database. Decryption happens server-side only when the recipient is allowed.' },
                  { title: 'Tied to first name', description: 'Linked to recipient by first-name slug (not user account) so it works even before the child has a vault login.' },
                ],
              },
            ]}
          />
        </div>
        <p className="mt-3 text-xs uppercase tracking-[0.3em] text-stone-500">
          A vault of words, kept safe until the time is right.
        </p>
      </header>

      <LettersUI
        recipients={[...LETTER_RECIPIENTS]}
        parentRecipients={parentRecipients}
        myRecipientSlug={myRecipientSlug}
        myParentSlug={myParentSlot?.slug ?? null}
        isSuperuser={isSuperuser}
        currentUserId={userId}
        lettersByRecipient={lettersByRecipient}
        noteToByParent={noteToByParent}
        countByRecipient={countByRecipient}
      />
    </div>
  )
}
