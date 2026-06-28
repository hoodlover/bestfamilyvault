import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories, entries, notes, files } from '@/lib/db/schema'
import { eq, and, desc, isNull, inArray, or, arrayContains, asc } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, X } from 'lucide-react'
import { EntryGrid } from '@/components/ui/entry-grid'
import { NoteCard } from '@/components/ui/note-card'
import { getCategoryIcon, getCategoryLabel, getSubcategoryIcon, getSubcategoryLabel } from '@/lib/category-presentation'
import { HelpPopout } from '@/components/ui/help-popout'
import { decryptEntries, decryptNotes } from '@/lib/crypto'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sub?: string; type?: string }>
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { sub, type } = await searchParams
  const session = await auth()
  const isSuperuser = session?.user?.role === 'superuser'
  const canEdit = session?.user?.role !== 'readonly'

  const category = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug))
    .then((r) => r[0])

  if (!category) notFound()

  const userId = session?.user?.id ?? ''

  const [subs, allSubcategories, allCategories, categoryEntriesRaw] = await Promise.all([
    db.select().from(subcategories).where(eq(subcategories.categoryId, category.id)).orderBy(subcategories.sortOrder),
    db.select().from(subcategories),
    db.select().from(categories).orderBy(categories.sortOrder),
    db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.categoryId, category.id),
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
          isNull(entries.parentEntryId),
          sub ? eq(entries.subcategoryId, sub) : undefined,
          type ? eq(entries.type, type as 'login' | 'note' | 'document' | 'bank_account' | 'credit_card' | 'identity' | 'asset') : undefined
        )
      )
      .orderBy(desc(entries.updatedAt)),
  ])

  // Notes filter for the picked subcategory. Recipes can be tagged with
  // multiple subcategory NAMES in notes.tags[] (the multi-select on the
  // recipe form), AND the FIRST pick also lands on notes.subcategoryId
  // as the primary. So the right filter is "subcategoryId OR tags
  // contains name". When the picked sub has CHILDREN (e.g. Holidays
  // has Christmas/Easter/Thanksgiving), we also match any child's name
  // in tags — clicking Holidays shows everything in any holiday sub.
  // Done as a second await (not Promise.all) because we need the subs
  // result first to resolve names. ~50ms extra round-trip.
  const subRow = sub ? subs.find((s) => s.id === sub) : null
  const subName = subRow?.name ?? null
  const childSubNames = sub
    ? subs.filter((s) => s.parentSubcategoryId === sub).map((s) => s.name)
    : []
  const allTagNames = subName ? [subName, ...childSubNames] : []
  const categoryNotesRaw = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.categoryId, category.id),
        isSuperuser ? undefined : eq(notes.isPrivate, false),
        or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
        sub && subName
          ? or(
              eq(notes.subcategoryId, sub),
              // arrayContains with one name = exact match; for a parent
              // with kids we OR each name into the predicate.
              ...allTagNames.map((n) => arrayContains(notes.tags, [n])),
            )
          : undefined,
      )
    )
    .orderBy(desc(notes.updatedAt))

  const categoryEntries = decryptEntries(categoryEntriesRaw)
  const categoryNotes = decryptNotes(categoryNotesRaw)

  // Receipt totals — only meaningful when we're inside the Receipts
  // category. Aggregates every entry whose customFields.kind === 'receipt'
  // in the current filtered view. Splits YTD vs lifetime so the banner
  // can show both. Skipped entirely for non-receipts categories so we
  // don't pay the JS aggregation cost on unrelated pages.
  let receiptStats: { ytdCents: number; lifetimeCents: number; ytdCount: number; lifetimeCount: number } | null = null
  if (category.slug === 'receipts') {
    const yearStart = `${new Date().getFullYear()}-01-01`
    let ytdCents = 0
    let lifetimeCents = 0
    let ytdCount = 0
    let lifetimeCount = 0
    for (const e of categoryEntries) {
      const cf = (e.customFields ?? {}) as Record<string, string>
      if (cf.kind !== 'receipt') continue
      const cents = Number(cf.totalCents)
      if (!Number.isFinite(cents)) continue
      const date = typeof cf.purchaseDate === 'string' ? cf.purchaseDate : null
      lifetimeCents += cents
      lifetimeCount += 1
      if (date && date >= yearStart) {
        ytdCents += cents
        ytdCount += 1
      }
    }
    receiptStats = { ytdCents, lifetimeCents, ytdCount, lifetimeCount }
  }

  const subMap = Object.fromEntries(subs.map((s) => [s.id, getSubcategoryLabel(category.slug, s.name)]))
  const activeSub = sub ? subs.find((s) => s.id === sub) : null
  const categoryLabel = getCategoryLabel(category.slug, category.name)
  const activeSubLabel = activeSub ? getSubcategoryLabel(category.slug, activeSub.name) : null
  const statusIcon = activeSub
    ? getSubcategoryIcon(category.slug, activeSub.name, activeSub.icon)
    : getCategoryIcon(category.slug, category.icon)

  // Fetch children for grouped entries
  const parentIds = categoryEntries.map((e) => e.id)
  const childEntries = parentIds.length > 0
    ? decryptEntries(await db.select().from(entries).where(inArray(entries.parentEntryId, parentIds)))
    : []
  const childrenMap: Record<string, typeof childEntries> = {}
  for (const child of childEntries) {
    if (child.parentEntryId) {
      if (!childrenMap[child.parentEntryId]) childrenMap[child.parentEntryId] = []
      childrenMap[child.parentEntryId].push(child)
    }
  }

  // First-image attachment per entry → used by EntryCard to show an
  // inline thumbnail in place of the generic globe icon. Ordered by
  // upload time ascending so the OLDEST image wins (most likely the
  // canonical photo the user added when creating the entry). Served
  // via the auth'd file proxy (?preview=1 → Content-Disposition: inline).
  const imageRows = parentIds.length > 0
    ? await db
        .select({ entryId: files.entryId, id: files.id, createdAt: files.createdAt, contentType: files.contentType })
        .from(files)
        .where(inArray(files.entryId, parentIds))
        .orderBy(asc(files.createdAt))
    : []
  const previewByEntryId: Record<string, string> = {}
  for (const r of imageRows) {
    if (!r.entryId) continue
    if (!r.contentType?.startsWith('image/')) continue
    if (previewByEntryId[r.entryId]) continue
    previewByEntryId[r.entryId] = `/api/files/${r.id}?preview=1`
  }

  // Per-entry attachment counts — drives the paperclip chip on each
  // card. Built from the same image-row scan above plus a quick
  // second pass for non-image files, all under one inArray on parents.
  // Cheaper than a separate count query.
  const attachmentCountByEntryId: Record<string, number> = {}
  if (parentIds.length > 0) {
    const allFilesForEntries = await db
      .select({ entryId: files.entryId })
      .from(files)
      .where(inArray(files.entryId, parentIds))
    for (const r of allFilesForEntries) {
      if (!r.entryId) continue
      attachmentCountByEntryId[r.entryId] = (attachmentCountByEntryId[r.entryId] ?? 0) + 1
    }
  }

  // Same shape for notes — drives the paperclip chip on every NoteCard
  // in the category browse. Uses the already-decrypted categoryNotes
  // for the id list; counts come from a separate inArray query.
  const noteIdsForCount = categoryNotes.map((n) => n.id)
  const attachmentCountByNoteId: Record<string, number> = {}
  if (noteIdsForCount.length > 0) {
    const allFilesForNotes = await db
      .select({ noteId: files.noteId })
      .from(files)
      .where(inArray(files.noteId, noteIdsForCount))
    for (const r of allFilesForNotes) {
      if (!r.noteId) continue
      attachmentCountByNoteId[r.noteId] = (attachmentCountByNoteId[r.noteId] ?? 0) + 1
    }
  }

  return (
    <div className="vault-page">
      {/* CobbBanner removed here — Lance asked for the top banner to
          stay off the category + subcategory pages. The breadcrumb +
          page header already provide context; the banner was visual
          weight without information. */}
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/dashboard" className="hover:text-stone-300 transition">Dashboard</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">{categoryLabel}</span>
      </nav>

      {/* Header */}
      <div className="vault-card mb-6 flex items-start justify-between gap-3 rounded-2xl p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={statusIcon}
            width={104}
            height={104}
            alt=""
            className="h-20 w-20 md:h-[104px] md:w-[104px] object-contain shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-2xl font-bold leading-tight text-stone-100 md:text-3xl">
              <span className="min-w-0 break-words">{categoryLabel}</span>
              {activeSub && (
                <>
                  <span className="text-stone-600">/</span>
                  <span className="min-w-0 break-words text-emerald-200">{activeSubLabel}</span>
                </>
              )}
              <HelpPopout
                title={categoryLabel}
                sections={[
                  {
                    heading: 'Browse',
                    tips: [
                      { title: 'Subcategory pills', description: 'Below the title — click any to filter the list. "All" clears the filter.' },
                      { title: 'Entry type filters', description: 'Pills below the subcategories (Logins / Notes / Docs / Banks / CCs). Hidden on recipe-only categories where they don\'t apply.' },
                      { title: 'Nested children', description: 'On Recipes: Holidays expands into Christmas / Easter / Thanksgiving. Clicking Holidays matches any child too.' },
                    ],
                  },
                  {
                    heading: 'Add new',
                    tips: [
                      { title: '+ Add first entry', description: 'Shown when the category is empty. On Recipes it routes to /recipes/new (the structured form) instead of the generic entry form.' },
                      { title: 'Pre-filled category', description: 'The new-entry button passes this category through so you don\'t have to pick it again on the form.' },
                    ],
                  },
                  {
                    heading: 'See entries + notes',
                    tips: [
                      { title: 'Top section', description: 'Entries (logins / banks / docs / etc.) for this category in card grid.' },
                      { title: 'Notes section', description: 'Free-form notes filed under this category. On Recipes, this becomes the "Recipes" section.' },
                      { title: 'Card pills', description: 'Notes show recipe-type abbrev pills (SLO, MEA, etc.) when they\'re tagged.' },
                    ],
                  },
                ]}
              />
            </h1>
            {activeSub && (
              <Link
                href={`/categories/${slug}`}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-stone-500 transition hover:text-stone-300"
              >
                <X size={12} />
                Show all {categoryLabel}
              </Link>
            )}
          </div>
        </div>
        {/* Quick-add button — drops the user straight into the new-entry
            form with this category (and subcategory, if filtered) pre-
            selected. Hidden on the Recipes category because recipes use
            a structured form at /recipes/new, not the generic flow. */}
        {canEdit && category.slug !== 'recipes' && (
          <Link
            href={
              activeSub
                ? `/entries/new?categoryId=${category.id}&subcategoryId=${activeSub.id}`
                : `/entries/new?categoryId=${category.id}`
            }
            title={activeSub ? `Add to ${activeSubLabel}` : `Add to ${categoryLabel}`}
            aria-label={activeSub ? `Add to ${activeSubLabel}` : `Add to ${categoryLabel}`}
            className="shrink-0 self-center"
          >
            <img
              src="/icons/cobb/icons/system/add.png"
              width={64}
              height={64}
              alt=""
              className="object-contain rounded-lg hover:scale-105 transition"
            />
          </Link>
        )}
      </div>

      {/* Subcategory tabs */}
      {subs.length > 0 && (
        <div className="mb-6 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-stone-700/40 bg-stone-950/30 p-2 md:gap-2">
          <Link
            href={`/categories/${slug}`}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition md:px-3 ${!sub ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'}`}
          >
            All
          </Link>
          {subs.map((s) => {
            const active = sub === s.id
            // All tab icons are the same size (27px = old 22 + 20%). Active
            // state is conveyed by the bg-stone-700 pill background only —
            // keeping the swelling-icon behavior was visually confusing
            // because it shifted layout across the row.
            return (
              <Link
                key={s.id}
                href={`/categories/${slug}?sub=${s.id}`}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition md:gap-2 md:px-3 ${active ? 'bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/30' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'}`}
              >
                <img
                  src={getSubcategoryIcon(category.slug, s.name, s.icon)}
                  width={27}
                  height={27}
                  alt=""
                  className="hidden h-6 w-6 object-contain rounded shrink-0 md:block"
                />
                {getSubcategoryLabel(category.slug, s.name)}
              </Link>
            )
          })}
        </div>
      )}

      {/* Receipt totals banner — only shows when we're inside the
          Receipts category. Always renders both YTD and lifetime so the
          banner is useful when filtered to a single LLC subcategory AND
          when viewing all LLCs together. */}
      {receiptStats && (
        <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl border border-emerald-800/40 bg-gradient-to-br from-emerald-950/40 to-stone-900/60 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">{new Date().getFullYear()} YTD</span>
            <span className="text-xl font-bold text-emerald-300">
              {(receiptStats.ytdCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">YTD count</span>
            <span className="text-base font-semibold text-stone-200">
              {receiptStats.ytdCount}
              <span className="text-xs text-stone-500 ml-1">of {receiptStats.lifetimeCount}</span>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-stone-500">All-time</span>
            <span className="text-sm font-semibold text-stone-400">
              {(receiptStats.lifetimeCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </span>
          </div>
        </div>
      )}

      {/* (Entry-type filter row removed — it was visual clutter that
          almost no one used. Subcategory chips above are doing the
          filtering work, and the "X Show all {categoryLabel}" link in
          the header clears the active sub. `?type=` URL params are
          still honored by the server query if a deep link supplies one,
          but there's no UI to set them anymore.) */}

      {/* Entries — on the Recipes category we hide the "No entries"
          empty state when there ARE recipe notes to show below (you
          don't store recipes as `entries`, you store them as `notes`).
          The Add-first-entry link also routes to /recipes/new on this
          category so a stray click doesn't drop you into the wrong
          form. */}
      {(() => {
        const isRecipes = category.slug === 'recipes'
        const newHref = isRecipes
          ? '/recipes/new'
          : `/entries/new?categoryId=${category.id}`
        const hideEmptyEntries = categoryEntries.length === 0 && categoryNotes.length > 0
        if (hideEmptyEntries) return null
        return (
          <EntryGrid
            entries={categoryEntries}
            childrenMap={childrenMap}
            allCategories={allCategories}
            allSubcategories={allSubcategories}
            categoryName={categoryLabel}
            subMap={subMap}
            statusIcon={statusIcon}
            canEdit={canEdit}
            categoryId={category.id}
            newEntryHref={newHref}
            previewByEntryId={previewByEntryId}
            attachmentCountByEntryId={attachmentCountByEntryId}
          />
        )
      })()}

      {/* Notes */}
      {categoryNotes.length > 0 && (
        <section>
          <h2 className="vault-kicker mb-3">
            {category.slug === 'recipes' ? 'Recipes' : 'Notes in this category'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {categoryNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                attachmentCount={attachmentCountByNoteId[note.id]}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
