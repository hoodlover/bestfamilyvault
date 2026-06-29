import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, categories, users } from '@/lib/db/schema'
import { eq, desc, and, or, isNull, asc, inArray, sql } from 'drizzle-orm'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { ActivityTabs } from '@/components/ui/activity-tabs'
import { getAttachmentCountsByNote } from '@/lib/actions/entries'
import { SecretTapEgg } from '@/components/ui/secret-tap-egg'
import { FamilyAvatarRow } from '@/components/ui/family-avatar-row'
import { FamilyInfoTile } from '@/components/ui/family-info-tile'
import { getFamilyVitals } from '@/lib/family-vitals'
import { isOwnerEmail } from '@/lib/family-config'
import { CobbBanner, AilencodeCredit } from '@/components/ui/cobb-banner'
import { HelpPopout } from '@/components/ui/help-popout'
import { OnThisDayCard } from '@/components/ui/on-this-day-card'
import { NetWorthCard } from '@/components/ui/net-worth-card'
import { getNetWorth } from '@/lib/net-worth'
import { LlcSnapshotCard } from '@/components/ui/llc-snapshot-card'
import { getLlcSnapshot } from '@/lib/llc-snapshot'
import { PriceCreepCard } from '@/components/ui/price-creep-card'
import { detectPriceCreep } from '@/lib/price-creep'
import { BirthdayBanner } from '@/components/ui/birthday-banner'
import { WelcomeCard } from '@/components/ui/welcome-card'
import { RecurringSuggestionBanner } from '@/components/ui/recurring-suggestion-banner'
import { IdnwReviewBanner } from '@/components/ui/idnw-review-banner'
import { countStaleYearlyTopics } from '@/lib/actions/dead-now-what'
import { MobileHeroDismiss } from '@/components/ui/mobile-hero-dismiss'
import { getDisplayVersion } from '@/lib/branding'
import { pickOnThisDay } from '@/lib/on-this-day'
import { decryptEntries, decryptNotes } from '@/lib/crypto'
import { getMyEntryFavoriteIds, getMyNoteFavoriteIds } from '@/lib/actions/favorites'
import { CategoriesTile } from '@/components/ui/categories-overlay'
import { getCategoryIcon, getCategoryLabel } from '@/lib/category-presentation'

export default async function DashboardPage() {
  const session = await auth()
  const isSuperuser = session?.user?.role === 'superuser'
  const canEdit = session?.user?.role !== 'readonly'
  const userId = session?.user?.id ?? ''
  // Owner-only: Lance (matched by his configured emails) or any superuser
  // can edit other family members' profile fields from the popout.
  const canEditFamily = isSuperuser || isOwnerEmail(session?.user?.email)

  // Look up the current user's favorite entry IDs first; favorites are
  // per-user (entry_favorite join table), so a global is_favorite query
  // would mix Heather's stars into Lance's view and vice versa.
  const [favEntryIds, favNoteIds] = userId
    ? await Promise.all([getMyEntryFavoriteIds(userId), getMyNoteFavoriteIds(userId)])
    : [new Set<string>(), new Set<string>()]
  const favEntryIdList = [...favEntryIds]

  const [recentEntriesRaw, favoriteEntriesRaw, recentNotesRaw, allCategories, familyUsers, onThisDay, netWorth, priceCreepAlerts] = await Promise.all([
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
      .orderBy(desc(entries.updatedAt))
      .limit(8),
    favEntryIdList.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(entries)
          .where(
            and(
              inArray(entries.id, favEntryIdList),
              isSuperuser ? undefined : eq(entries.isPrivate, false),
              // isPersonal is owner-only — superuser does NOT bypass.
              or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
              isNull(entries.parentEntryId)
            )
          )
          .orderBy(desc(entries.updatedAt))
          .limit(6),
    db
      .select()
      .from(notes)
      .where(
        and(
          isSuperuser ? undefined : eq(notes.isPrivate, false),
          or(eq(notes.isPersonal, false), eq(notes.createdBy, userId))
        )
      )
      .orderBy(desc(notes.updatedAt))
      .limit(4),
    db.select().from(categories).orderBy(categories.sortOrder),
    // Main user fetch — intentionally does NOT include date_of_birth so a
    // pre-migration prod (column doesn't exist yet) doesn't 500 the whole
    // dashboard. Birthday data is fetched separately below in a try/catch.
    // Main user fetch — keep it free of any recently-added columns so a
    // pre-migration prod (column doesn't exist yet) doesn't 500 the whole
    // dashboard. dateOfBirth and voiceMemoBlobUrl are pulled separately
    // below in try/catch wrappers.
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        updatedAt: users.updatedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.createdAt)),
    pickOnThisDay(userId, session?.user?.role ?? 'readonly', session?.user?.name),
    getNetWorth(userId, session?.user?.role ?? 'readonly'),
    detectPriceCreep(userId, session?.user?.role ?? 'readonly'),
  ])

  // Path to Change LLC snapshot — runs in parallel with the other dashboard
  // queries, separate from the existing Promise.all so the addition is
  // localized and easy to revert. Visible to everyone who can see the LLC's
  // entries (no superuser/admin gate per Lance's call), so members see
  // their own slice without unlocking the family-wide net-worth widget.
  const pathToChangeSnapshot = userId
    ? await getLlcSnapshot(userId, session?.user?.role ?? 'readonly', 'path-to-change-llc')
    : null

  // Family quick-glance vitals — defensively wrapped so a missing
  // column on a pre-migration prod doesn't blank the whole dashboard.
  // The helper soft-fails internally; we also wrap the call itself.
  let familyVitals: Awaited<ReturnType<typeof getFamilyVitals>> = { members: [], lastUpdated: null }
  try { familyVitals = await getFamilyVitals() } catch (err) {
    console.warn('[dashboard] getFamilyVitals failed:', err instanceof Error ? err.message : err)
  }

  // "Has this user contributed anything yet?" — drives the WelcomeCard.
  // Family-wide entries/notes may be plentiful when a new member joins,
  // so the count must be scoped to createdBy === userId, not the whole
  // vault. Counts both tables so adding a note also dismisses the card.
  const myContributionCount = userId
    ? await (async () => {
        const [eRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(entries)
          .where(eq(entries.createdBy, userId))
        const [nRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notes)
          .where(eq(notes.createdBy, userId))
        return (eRow?.count ?? 0) + (nRow?.count ?? 0)
      })()
    : 0

  // Voice memo data — soft-fail if the column doesn't exist (run db:push
  // to fix). Same defensive pattern as dateOfBirth above.
  const hasMemoByUser = new Map<string, boolean>()
  try {
    const memoRows = await db
      .select({ id: users.id, voiceMemoBlobUrl: users.voiceMemoBlobUrl })
      .from(users)
    for (const r of memoRows) hasMemoByUser.set(r.id, !!r.voiceMemoBlobUrl)
  } catch (err) {
    console.warn(
      '[dashboard] voiceMemoBlobUrl query failed — run `npm run db:push` to add the column.',
      err instanceof Error ? err.message : err
    )
  }

  // Birthday data — soft-fail if the column doesn't exist (run db:push to fix).
  // Stored separately and merged in below so the dashboard always renders.
  const dobByUser = new Map<string, Date>()
  try {
    const dobRows = await db
      .select({ id: users.id, dateOfBirth: users.dateOfBirth })
      .from(users)
    for (const r of dobRows) if (r.dateOfBirth) dobByUser.set(r.id, r.dateOfBirth)
  } catch (err) {
    console.warn(
      '[dashboard] dateOfBirth query failed — run `npm run db:push` to add the column.',
      err instanceof Error ? err.message : err
    )
  }

  // Decrypt sensitive fields server-side before they reach the client.
  const recentEntries = decryptEntries(recentEntriesRaw)
  const favoriteEntries = decryptEntries(favoriteEntriesRaw)
  const recentNotes = decryptNotes(recentNotesRaw)

  // Per-note attachment counts → fuel the paperclip chip on every
  // NoteCard in the dashboard's Recent tab. Soft-fails to an empty
  // record if the query errors so the dashboard stays up.
  const recentNoteAttachmentCounts: Record<string, number> = await (async () => {
    try {
      const m = await getAttachmentCountsByNote(recentNotes.map((n) => n.id))
      return Object.fromEntries(m.entries())
    } catch {
      return {}
    }
  })()

  // Count of yearly-review IDNW topics whose answer hasn't been touched
  // in > 12 months. Only the superuser (Lance) is nagged about this —
  // family members can't edit guide topics, so the banner would just be
  // noise for them. countStaleYearlyTopics is defensive: it returns 0
  // on any failure, so the dashboard never crashes because of it.
  const staleIdnwCount = isSuperuser ? await countStaleYearlyTopics() : 0

  const catMap = Object.fromEntries(allCategories.map((c) => [c.id, c.name]))

  const familyMembers = familyUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    hasImage: u.image !== null && u.image !== '',
    updatedAt: u.updatedAt.getTime(),
    hasVoiceMemo: hasMemoByUser.get(u.id) ?? false,
  }))

  // Birthday detection: today's MM-DD vs each user's DOB. The signed-in user
  // gets the celebratory variant; others get a "say hi" variant.
  const today = new Date()
  const todayMD = `${today.getMonth() + 1}-${today.getDate()}`
  const isBirthday = (dob: Date | null | undefined) => {
    if (!dob) return false
    return `${dob.getUTCMonth() + 1}-${dob.getUTCDate()}` === todayMD
  }
  const myDob = dobByUser.get(userId) ?? null
  const isYourBirthday = isBirthday(myDob)
  const otherBirthdays = familyUsers
    .filter((u) => u.id !== userId && isBirthday(dobByUser.get(u.id)))
    .map((u) => {
      const dob = dobByUser.get(u.id)
      return {
        id: u.id,
        firstName: (u.name ?? u.email ?? '?').split(' ')[0],
        yearOfBirth: dob ? dob.getUTCFullYear() : null,
      }
    })

  return (
    <div className="vault-page">
      {/* Big bigbanner.png artwork — on mobile, slides up and off the
          screen 30 s after first paint and stays gone for the session
          and up to 24 h. Force-close brings it back. On desktop it
          stays put always (MobileHeroDismiss's md: overrides ignore the
          collapsed state). */}
      <MobileHeroDismiss>
        <CobbBanner compact />
      </MobileHeroDismiss>

      {/* Mobile header (mobile redesign) — compact crest + greeting.
          Stays put; only the banner above auto-dismisses. The Family Info
          quick-access icon does NOT live in this row — it's mounted as a
          floating element below, sized + positioned to sit inline with
          the floating user avatar (UserMenu, top-right corner of every
          dashboard page) so the two icons read as a paired top-right
          control cluster. */}
      <div className="md:hidden flex items-center gap-3 mb-4">
        <SecretTapEgg taps={2} popupSrc="/icons/cobb/icons/auto/maverick_road.png" popupScale={1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/animals.png"
            width={46}
            height={46}
            alt=""
            className="object-contain rounded-[12px] brightness-110 shrink-0"
          />
        </SecretTapEgg>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight text-stone-100 truncate">
            Hi, {session?.user?.name?.split(' ')[0]}
          </h1>
          <p className="text-xs text-stone-400 mt-0.5">
            What do you need from the{' '}
            <SecretTapEgg taps={2} popupSrc="/icons/cobb/icons/auto/maverick_camping.png" popupScale={1}>
              <span>vault</span>
            </SecretTapEgg>
            ?
          </p>
        </div>
      </div>

      {/* Floating mobile-only Family Info button — sits inline with the
          real user avatar (UserMenu, top-3 right-3 in the layout) but
          just to its left. Lance wanted the two upper-corner controls
          paired so the family-info access reads as "alongside my own
          profile menu" rather than crowded next to the welcome row's
          tap-egg avatar. Desktop continues to use the inline header
          placement at line ~333. */}
      <div className="md:hidden fixed top-3 right-16 z-40">
        <FamilyInfoTile vitals={familyVitals.members} lastUpdated={familyVitals.lastUpdated} variant="header" canEditOthers={canEditFamily} />
      </div>

      {/* Mobile pill search — submits via plain GET so the page can stay
          server-rendered. Desktop has the sidebar's search field. */}
      <form action="/search" method="GET" className="md:hidden mb-5">
        <div className="flex items-center gap-2 px-4 rounded-full bg-stone-900/60 border border-stone-700/40 focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/20 transition">
          <Search size={18} className="text-stone-500 shrink-0" aria-hidden />
          <input
            type="search"
            name="q"
            placeholder="Search the vault…"
            aria-label="Search the vault"
            className="flex-1 min-w-0 bg-transparent py-2.5 text-base text-stone-100 placeholder:text-stone-500 focus:outline-none"
          />
        </div>
      </form>

      {/* Desktop header — full version with the lock easter egg and
          HelpPopout. Hidden on mobile (the compact header above takes
          its place). */}
      <div className="hidden md:flex items-center justify-between gap-4 mb-5 md:mb-8">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-stone-100 flex items-center gap-3">
            <SecretTapEgg taps={2} popupSrc="/icons/cobb/icons/auto/maverick_road.png" popupScale={1}>
              <img src="/icons/cobb/icons/system/blue_lock.png" width={68} height={68} alt="" className="object-contain rounded-xl" />
            </SecretTapEgg>
            <span className="truncate">Hi, {session?.user?.name?.split(' ')[0]}</span>
            <HelpPopout
              title="Dashboard"
              sections={[
                {
                  heading: 'What\'s on this page',
                  tips: [
                    { title: 'Category tiles', description: 'Big colored tiles for each major area — tap any to drill in. Order reflects how often you use it.' },
                    { title: 'On-this-day', description: 'Surfaces entries / notes / files added on this date in past years. Quiet most days, magical on anniversaries.' },
                    { title: 'Money widgets', description: 'Net worth + bills due (admin/superuser only). Quick glance at where things stand.' },
                    { title: 'Family birthdays banner', description: 'When someone\'s birthday is within a week, a banner appears at the top.' },
                  ],
                },
                {
                  heading: 'Add stuff fast',
                  tips: [
                    { title: 'New entry button', description: 'Per-type creation: login, bank account, credit card, identity doc, plain note. Each type gets its own form.' },
                    { title: 'Quick lookups', description: 'Search bar (top right) finds across entries, notes, files. Phrases in quotes match exactly.' },
                  ],
                },
                {
                  heading: 'More',
                  tips: [
                    { title: 'PWA install', description: 'Add this to your home screen — the floating Install prompt or browser menu → "Add to Home Screen".' },
                    { title: 'Guide page', description: '/guide — long-form tips + feature list. Complement to these per-page popouts.' },
                  ],
                },
              ]}
            />
          </h1>
          <p className="text-stone-400 text-sm mt-0.5">
            What do you need from the family{' '}
            <SecretTapEgg taps={2} popupSrc="/icons/cobb/icons/auto/maverick_camping.png" popupScale={1}>
              <span>vault</span>
            </SecretTapEgg>
            ?
          </p>
        </div>
        {/* Family Info quick-access — sits in the top-right of the
            desktop hero so it's reachable without scrolling. Same modal
            as the tile in the grid below. */}
        <FamilyInfoTile vitals={familyVitals.members} lastUpdated={familyVitals.lastUpdated} variant="header" canEditOthers={canEditFamily} />
      </div>

      {userId && myContributionCount === 0 && (
        <WelcomeCard
          userId={userId}
          firstName={(session?.user?.name ?? '').split(' ')[0] || 'there'}
        />
      )}

      <BirthdayBanner
        isYourBirthday={isYourBirthday}
        others={otherBirthdays}
        yourFirstName={(session?.user?.name ?? '').split(' ')[0] || 'friend'}
        yourYearOfBirth={myDob ? myDob.getUTCFullYear() : null}
      />
      {userId && <RecurringSuggestionBanner userId={userId} />}
      {onThisDay && <OnThisDayCard item={onThisDay} />}
      <IdnwReviewBanner count={staleIdnwCount} />

      {/* Action tiles, themed into two clear rows:
            Capture (Add / Upload / Upload Receipt) — verbs that put
              stuff into the vault.
            Browse  (Find / Notes / Receipts) — verbs that pull stuff
              back out.
          3 tiles per row removes the lonely-5th-tile problem from the
          previous 2-col layout. */}
      <section className="mb-5 md:mb-7">
        <h2 className="vault-kicker mb-2">Add to vault</h2>
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          <ActionTile
            href="/entries/new?type=login"
            img="/icons/cobb/icons/system/add_password.png"
            title="Add"
            detail="Password, Note"
            accent="amber"
          />
          <ActionTile
            href="/entries/new?type=upload"
            img="/icons/cobb/icons/system/add_upload.png"
            title="Upload"
            detail="Docs & Images"
            accent="sky"
          />
          <ActionTile
            href="/receipts/new"
            img="/icons/cobb/icons/system/upload_receipt_icon_512.png"
            title="Upload Receipt"
            detail="Snap, read, file"
            accent="emerald"
          />
        </div>
      </section>

      <section className="mb-7 md:mb-9">
        <h2 className="vault-kicker mb-2">Find &amp; browse</h2>
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {/* Categories tile — replaces the Recipes tile (Recipe Book
              still lives in the sidebar's Plan group). One tap opens a
              blurred-backdrop popup listing every category, replacing
              the standalone category grid that used to live further
              down the home screen. */}
          <CategoriesTile
            categories={allCategories}
            img="/icons/cobb/icons/system/stale_entries.png"
            title="Categories"
            detail="Browse all"
            accent="emerald"
          />
          <ActionTile
            href="/notes"
            img="/icons/cobb/icons/system/browsenotes.png"
            title="Notes"
            detail="Browse"
            accent="red"
          />
          <ActionTile
            href="/todos"
            img="/icons/cobb/icons/system/to_do.png"
            title="To Do"
            detail="Quick lists"
            accent="amber"
          />
        </div>
      </section>

      {/* Quick-link tile rows — 5 rows × 2 tiles = 10 entries total.
          Order per Lance's spec (v306):
            Row 1 · My Private Vault     · Family Info
            Row 2 · Where Is It?         · Contacts
            Row 3 · Meal plan            · Cards
            Row 4 · Recipes              · Assets
            Row 5 · IDNW?                · Break Glass…
          Family Info is a popout (modal), every other tile is a Link. */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link
          href="/my-vault"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium focus:outline-none focus-visible:outline-none transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/lockvault.png" width={45} height={45} alt="" className="object-contain rounded" />
          My Private Vault
        </Link>
        <FamilyInfoTile vitals={familyVitals.members} lastUpdated={familyVitals.lastUpdated} />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link
          href="/locate"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/locate.png" width={45} height={45} alt="" className="object-contain rounded" />
          Where Is It?
        </Link>
        <Link
          href="/contacts"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/contacts.png" width={45} height={45} alt="" className="object-contain rounded" />
          Contacts
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link
          href="/meal-plan"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/Recipes/meal_pla.png" width={45} height={45} alt="" className="object-contain rounded" />
          Meal plan
        </Link>
        <Link
          href="/cards"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/creditcard.png" width={45} height={45} alt="" className="object-contain rounded" />
          Cards
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Link
          href="/recipes"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/Recipes/recipes_book.png" width={45} height={45} alt="" className="object-contain rounded" />
          Recipes
        </Link>
        <Link
          href="/assets"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/asset.png" width={45} height={45} alt="" className="object-contain rounded" />
          Assets
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        <Link
          href="/now-what"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/IDNW.png" width={45} height={45} alt="" className="object-contain rounded" />
          IDNW?
        </Link>
        <Link
          href="/now-what/emergency-sheet"
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium transition hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30"
        >
          <img src="/icons/cobb/icons/system/breakglass.png" width={45} height={45} alt="" className="object-contain rounded" />
          Break Glass&hellip;
        </Link>
      </div>

      {/* Category grid — restored after Lance preferred keeping the
          full grid on the home page. The Categories popup (launched
          from "Find & browse → Categories" above) is an additional
          fast path, not a replacement for the inline grid. */}
      <section className="mb-8 md:mb-10">
        <h2 className="vault-kicker mb-3">Categories</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          {/* IDNW has its own dashboard pill at the top of the page; the
              auto-seeded "I'm Dead, Now What?" category is filtered from
              this grid so the pill is the only home for it. */}
          {allCategories.filter((cat) => cat.slug !== 'now-what').map((cat) => (
            <Link
              key={cat.id}
              // Receipts gets its own top-level summary view at /receipts —
              // YTD totals per LLC tile. Other categories route through the
              // generic /categories/<slug> page.
              href={cat.slug === 'receipts' ? '/receipts' : `/categories/${cat.slug}`}
              className="vault-card vault-card-hover group flex min-h-24 items-center gap-3 rounded-xl p-3 md:p-4"
            >
              <img src={getCategoryIcon(cat.slug, cat.icon)} width={72} height={72} alt="" className="object-contain shrink-0 rounded-md" />
              <span className="text-sm font-medium text-stone-200 group-hover:text-white">{getCategoryLabel(cat.slug, cat.name)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Financial widgets — net worth + price creep stay gated to
          superuser + admin only ("Money headlines aren't the first thing
          anyone in the family should see"). The LLC snapshot below ships
          to every role so a member who can see PTC entries also gets the
          rollup. */}
      {(isSuperuser || session?.user?.role === 'admin') && (
        <section className="mb-8 md:mb-10 space-y-3">
          <NetWorthCard snapshot={netWorth} />
          <PriceCreepCard alerts={priceCreepAlerts} />
        </section>
      )}
      {pathToChangeSnapshot && (
        <section className="mb-8 md:mb-10">
          <LlcSnapshotCard snapshot={pathToChangeSnapshot} href="/categories/finance" />
        </section>
      )}

      {/* Family avatars — own opens settings, others open send-message modal */}
      <FamilyAvatarRow members={familyMembers} currentUserId={userId} />

      {/* Activity — tabbed Favorites / Recent / Notes. Defaults to
          Favorites when the user has any; else Recent. Collapses three
          stacked sections into one widget so the dashboard's vertical
          rhythm doesn't run on. */}
      <ActivityTabs
        favorites={favoriteEntries}
        recents={recentEntries}
        recentNotes={recentNotes}
        favEntryIds={favEntryIds}
        favNoteIds={favNoteIds}
        catMap={catMap}
        canEdit={canEdit}
        noteAttachmentCounts={recentNoteAttachmentCounts}
      />

      <div className="mt-12 flex flex-col items-center gap-3 opacity-50">
        <div className="flex items-center gap-4">
          <Link
            href="/letters"
            title="Family Letters"
            aria-label="Family Letters"
            className="block transition hover:opacity-90 active:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/dad_love_letters.png"
              alt="Family Letters"
              width={84}
              height={84}
              className="block h-[84px] w-auto object-contain"
            />
          </Link>
          <AilencodeCredit size="lg" />
        </div>
        <Link
          href="/guide"
          className="text-[11px] uppercase tracking-[0.25em] text-stone-400 hover:text-stone-200 transition"
        >
          New here? Read the guide →
        </Link>
        {/* Mobile redesign: tagline kicker pairs the version chip the way
            the spec calls for. Desktop already feels resolved without it,
            so this is mobile-only. */}
        <span className="cv-kicker md:hidden">Family Life ... Secretly Kept</span>
        {/* Version chip — primary use is diagnosing stale PWA caches
            ("are you on v1.7.8 yet?"). Lance flagged this as nearly
            invisible at stone-700; bumped to stone-400 + slightly
            larger so he can actually read it from across the room. */}
        <p className="text-xs font-mono text-stone-400 tracking-widest">
          v{getDisplayVersion()}
        </p>
      </div>
    </div>
  )
}


function ActionTile({
  href,
  img,
  title,
  detail,
  accent,
}: {
  href: string
  img: string
  title: string
  detail: string
  accent: 'emerald' | 'amber' | 'sky' | 'red'
}) {
  const accentClass = {
    emerald: 'border-emerald-700/40 hover:border-emerald-500/70',
    amber: 'border-amber-700/40 hover:border-amber-500/70',
    sky: 'border-sky-700/40 hover:border-sky-500/70',
    red: 'border-red-700/40 hover:border-red-500/70',
  }[accent]

  return (
    <Link
      href={href}
      // Mobile: icon stacked over the title, centered, detail subtitle
      // hidden — at 3-col phone widths the side-by-side layout clipped
      // labels like "Upload Receipt". Desktop (md+): restore the
      // original side-by-side icon + title + detail layout.
      className={`vault-card vault-card-hover group flex flex-col items-center text-center md:flex-row md:items-center md:text-left md:gap-3 gap-1.5 rounded-xl p-2.5 md:p-3 ${accentClass}`}
    >
      <span className="flex h-12 w-12 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-lg bg-stone-950/55 ring-1 ring-white/5">
        <img src={img} width={40} height={40} alt="" className="object-contain rounded md:w-[46px] md:h-[46px]" />
      </span>
      <span className="min-w-0 w-full">
        <span className="flex items-center justify-center md:justify-start text-[12px] md:text-sm font-semibold text-stone-100 leading-tight md:leading-normal">
          <span className="break-words">{title}</span>
        </span>
        <span className="hidden md:block mt-0.5 text-xs leading-snug text-stone-500 group-hover:text-stone-400">{detail}</span>
      </span>
    </Link>
  )
}
