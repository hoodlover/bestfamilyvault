// "Where Is It" — single-page accordion treasure-map (v257 rewrite).
//
// Every item the family needs to find lives as a notes row under the
// seeded `where-is-it` category with subcategory = the area (Cabin /
// Home / Garage / Office / Shed / Storage / Safe, plus anything the
// user has added inline). Page server-renders the full flat list +
// area list and hands them to a single client island that owns all
// the interactivity (sections, inline edit, drag-to-zoom photo crop,
// "+ New area").

import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { notes, categories, subcategories, files, users } from '@/lib/db/schema'
import { and, eq, or, asc, inArray, like } from 'drizzle-orm'
import { HelpPopout } from '@/components/ui/help-popout'
import { decryptNotes } from '@/lib/crypto'
import { LocateClient, type AreaShape, type LocateRowShape } from './client'

const CATEGORY_SLUG = 'where-is-it'

export default async function LocatePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'
  const canEdit = session.user.role !== 'readonly'
  // ?view=all = "show me what the kids see" preview for superusers.
  // Strips isPrivate rows + isPrivate photos so the page renders as a
  // regular family member would see it. Non-superusers don't get the
  // toggle and `previewAsFamily` always resolves to false for them.
  const { view } = await searchParams
  const previewAsFamily = isSuperuser && view === 'all'
  const seePrivate = isSuperuser && !previewAsFamily

  const category = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, CATEGORY_SLUG))
    .then((r) => r[0])

  // Seed safety net — preserves the v256 behaviour when the category
  // isn't there yet so the page never errors blank.
  if (!category) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-stone-100 mb-2">Where Is It?</h1>
        <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-6 text-sm text-amber-100 leading-relaxed">
          The category isn&rsquo;t seeded yet. Run{' '}
          <code className="text-xs bg-stone-800 border border-stone-700 px-1.5 py-0.5 rounded">
            npx tsx --env-file=.env.local scripts/seed-where-is-it.ts
          </code>{' '}
          and refresh this page.
        </div>
      </div>
    )
  }

  const subs = await db
    .select()
    .from(subcategories)
    .where(eq(subcategories.categoryId, category.id))
    .orderBy(asc(subcategories.sortOrder))

  // Visibility = the same rules every other page uses, except
  // superusers can opt into a "preview as family" view (?view=all)
  // that hides isPrivate rows the same way a non-superuser sees them.
  // Personal notes stay owner-only either way.
  const rawNoteRows = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.categoryId, category.id),
        seePrivate ? undefined : eq(notes.isPrivate, false),
        or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
      ),
    )
    .orderBy(asc(notes.createdAt))
  // Notes.content is encrypted at rest. Decrypt server-side before the
  // rows leave the page; without this the client sees raw ciphertext
  // (the "enc:v1:…" string) in every row's location field.
  const noteRows = decryptNotes(rawNoteRows)

  // Owner-name lookup so each row can show "added by X" subtly.
  const ownerIds = Array.from(new Set(noteRows.map((n) => n.createdBy).filter(Boolean) as string[]))
  const owners = ownerIds.length === 0
    ? []
    : await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ownerIds))
  const ownerById = new Map(owners.map((o) => [o.id, o.name ?? o.email ?? 'Family']))

  // First image attachment per note → the photo affordance on the row.
  // Mirrors the cards-page logic; oldest image wins (typically the
  // initial capture).
  const noteIds = noteRows.map((n) => n.id)
  const imageFiles = noteIds.length === 0
    ? []
    : await db
        .select({
          id: files.id,
          noteId: files.noteId,
          contentType: files.contentType,
          isPrivate: files.isPrivate,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(
          and(
            inArray(files.noteId, noteIds),
            like(files.contentType, 'image/%'),
          ),
        )
        .orderBy(files.createdAt)
  const photoByNote = new Map<string, { id: string; count: number }>()
  for (const f of imageFiles) {
    if (!f.noteId) continue
    // Same preview-as-family rule: hide isPrivate attachments when the
    // superuser is in ?view=all mode so the kid view actually matches
    // what a kid would render.
    if (f.isPrivate && !seePrivate) continue
    const prev = photoByNote.get(f.noteId)
    if (!prev) photoByNote.set(f.noteId, { id: f.id, count: 1 })
    else prev.count += 1
  }

  const areas: AreaShape[] = subs.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    sortOrder: s.sortOrder,
  }))

  const rows: LocateRowShape[] = noteRows.map((n) => {
    const photo = photoByNote.get(n.id) ?? null
    return {
      id: n.id,
      areaId: n.subcategoryId ?? '',
      title: n.title,
      content: n.content ?? '',
      photoFileId: photo?.id ?? null,
      photoCount: photo?.count ?? 0,
      ownerName: n.createdBy ? ownerById.get(n.createdBy) ?? null : null,
      isPrivate: n.isPrivate,
    }
  })

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      {/* Warm header — kept from v256; this remains a family page, not a
          spreadsheet. */}
      <div className="relative rounded-2xl border border-stone-600/50 bg-gradient-to-br from-amber-900/30 via-rose-900/20 to-emerald-900/20 p-4 md:p-6 mb-6 overflow-hidden">
        <div className="flex items-start gap-3 md:gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/locate.png"
            alt=""
            className="h-12 w-12 md:h-14 md:w-14 object-contain shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold text-stone-100 truncate">Where Is It?</h1>
              {/* Superuser-only preview toggle. Default view = Admin
                  (shows private items like "handgun in safe"); ?view=all
                  flips to the kid-safe view that hides isPrivate rows
                  and photos so Lance can sanity-check what the family
                  sees before sharing a tablet. Hidden for non-superusers
                  since they always see the family view anyway. */}
              {isSuperuser && (
                <div className="inline-flex rounded-full border border-stone-700/70 bg-stone-900/60 p-0.5 text-[11px] font-semibold">
                  <Link
                    href="/locate"
                    aria-current={!previewAsFamily ? 'page' : undefined}
                    className={`px-2.5 py-0.5 rounded-full transition ${!previewAsFamily ? 'bg-amber-700/70 text-amber-50' : 'text-stone-400 hover:text-stone-200'}`}
                  >
                    Admin view
                  </Link>
                  <Link
                    href="/locate?view=all"
                    aria-current={previewAsFamily ? 'page' : undefined}
                    className={`px-2.5 py-0.5 rounded-full transition ${previewAsFamily ? 'bg-emerald-700/70 text-emerald-50' : 'text-stone-400 hover:text-stone-200'}`}
                  >
                    Family view
                  </Link>
                </div>
              )}
              <HelpPopout
                title="Where Is It?"
                sections={[
                  {
                    heading: 'How to use it',
                    tips: [
                      { title: 'Everything on one page', description: 'Sections per area. Tap the + on a section to drop a row right under the last entry — no jumping to another screen.' },
                      { title: 'Click to edit', description: 'Tap an item name or location to edit it in place. Press Enter (or click somewhere else with both fields filled) to save.' },
                      { title: 'Search across everything', description: 'The box up top filters every section down to just the matching rows. Section labels stay visible so you still know which area each match lives in.' },
                    ],
                  },
                  {
                    heading: 'Photos',
                    tips: [
                      { title: 'Tick + photo to attach', description: 'On phone, the OS camera/gallery picker opens. Pick a shot — you can pan and zoom to highlight the exact spot before saving.' },
                      { title: 'View later', description: 'A row with a photo shows a small 📎 View link that opens the saved image in a new tab.' },
                    ],
                  },
                  {
                    heading: 'New areas',
                    tips: [
                      { title: '+ New area at the bottom', description: 'If Cabin / Home / Garage / etc. doesn’t cover it (Lake Boat, RV, In-laws’ house), type a new area name down at the bottom. It shows up as a fresh section right after.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm md:text-base text-stone-300 mt-1.5 max-w-prose leading-relaxed">
              Where the family&rsquo;s stuff lives. Add a thing, tag the area, and find it without tearing the house apart.
            </p>
          </div>
        </div>
      </div>

      <LocateClient areas={areas} rows={rows} canEdit={canEdit} isSuperuser={isSuperuser} />
    </div>
  )
}
