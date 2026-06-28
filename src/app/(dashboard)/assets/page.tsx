// Dedicated browse page for asset entries — Heather (and anyone who
// doesn't realise the Net Worth card on the dashboard is clickable) can
// reach her house / car / etc. straight from the side nav. Mirrors the
// shape of /cards: server-rendered tile grid, thumbnail per row, links
// out to the entry detail page.

import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, files, users } from '@/lib/db/schema'
import { and, eq, or, inArray, like, desc } from 'drizzle-orm'
import Link from 'next/link'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function AssetsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  // Same visibility rules as the rest of the vault: superuser sees
  // everything; everyone else sees non-private; personal entries are
  // owner-only and superuser does NOT bypass that.
  const rows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'asset'),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(desc(entries.currentBalance))

  // Owner avatar/name lookup — entries.createdBy → users.name.
  const ownerIds = Array.from(new Set(rows.map((r) => r.createdBy).filter(Boolean) as string[]))
  const owners = ownerIds.length === 0
    ? []
    : await db
        .select({ id: users.id, name: users.name, email: users.email, image: users.image })
        .from(users)
        .where(inArray(users.id, ownerIds))
  const ownerById = new Map(owners.map((o) => [o.id, { name: o.name ?? o.email ?? 'Family', image: o.image }]))

  // Image attachments for each entry — used to render the thumbnail.
  // The picker stores customFields.thumbnailFileId when the user pins
  // one; otherwise we fall back to the oldest image attached (matches
  // the cards-page behaviour).
  const entryIds = rows.map((r) => r.id)
  const imageFiles = entryIds.length === 0
    ? []
    : await db
        .select({
          id: files.id,
          entryId: files.entryId,
          contentType: files.contentType,
          isPrivate: files.isPrivate,
          createdAt: files.createdAt,
        })
        .from(files)
        .where(
          and(
            inArray(files.entryId, entryIds),
            like(files.contentType, 'image/%'),
          ),
        )
        .orderBy(files.createdAt)

  const oldestImageByEntry = new Map<string, string>()
  for (const f of imageFiles) {
    if (!f.entryId) continue
    if (f.isPrivate && !isSuperuser) continue
    if (!oldestImageByEntry.has(f.entryId)) oldestImageByEntry.set(f.entryId, f.id)
  }

  const tiles = rows.map((r) => {
    const cf = r.customFields ?? {}
    const fileId = cf.thumbnailFileId ?? oldestImageByEntry.get(r.id) ?? null
    const owner = r.createdBy ? ownerById.get(r.createdBy) : null
    return {
      id: r.id,
      title: r.title,
      kind: r.accountType ?? null,
      currentBalanceCents: r.currentBalance,
      balanceAsOf: r.balanceAsOf,
      thumbFileId: fileId,
      thumbOffsetX: numOr(cf.thumbnailOffsetX, 50),
      thumbOffsetY: numOr(cf.thumbnailOffsetY, 50),
      thumbScale: numOr(cf.thumbnailScale, 1),
      ownerName: owner?.name ?? null,
      ownerImage: owner?.image ?? null,
    }
  })

  const totalCents = tiles.reduce((acc, t) => acc + (t.currentBalanceCents ?? 0), 0)

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Compact mobile header — same chrome pattern as /cards. The +Add
          affordance reuses the asset add-entry route. */}
      <div className="md:hidden flex items-center gap-2 mb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/asset.png"
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 object-contain shrink-0"
        />
        <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Assets</h1>
        <span className="text-xs font-mono text-stone-500">{tiles.length}</span>
        <Link
          href="/entries/new?type=asset"
          aria-label="Add asset"
          className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/plus_entry.png"
            width={36}
            height={36}
            alt=""
            className="h-9 w-9 object-contain"
          />
        </Link>
      </div>

      <div className="hidden md:flex items-center gap-3 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/asset.png"
          alt=""
          width={48}
          height={48}
          className="object-contain shrink-0"
        />
        <h1 className="text-2xl font-bold text-stone-100">Assets</h1>
        <HelpPopout
          title="Assets"
          sections={[
            {
              heading: 'What is this',
              tips: [
                { title: 'Everything you own, by hand', description: 'Houses, cars, jewelry, tools — anything that isn\'t an account but still counts toward net worth. The Net Worth card on the dashboard also adds these up.' },
                { title: 'Today\'s value', description: 'Whatever Current Value you saved last; bumping it in Edit logs a new appraisal snapshot for history.' },
                { title: 'Thumbnail', description: 'The pinned thumbnail from each entry (or the first attached photo) shows on the tile. Tap the tile to open the full asset card.' },
              ],
            },
            {
              heading: 'Add an asset',
              tips: [
                { title: 'New asset', description: 'Use + Add → Asset, or the green plus on this page. Pick a kind (House, Car, Jewelry…), set Current Value, save.' },
                { title: 'Update value', description: 'Open any asset and edit the Current Value to refresh the appraisal. The new value is automatically logged as a snapshot.' },
              ],
            },
          ]}
        />
      </div>
      <p className="hidden md:block text-stone-400 text-sm mb-4">
        {tiles.length === 0
          ? 'Nothing here yet — tap +Add → Asset to track a house, car, or anything else.'
          : <>{tiles.length} asset{tiles.length === 1 ? '' : 's'} · combined value {formatCents(totalCents)}.</>}
      </p>

      {/* Desktop add affordance — sits above the grid mirroring /cards. */}
      <div className="hidden md:flex mb-4">
        <Link
          href="/entries/new?type=asset"
          className="inline-flex items-center gap-2 px-3 py-2 bg-stone-900/60 border border-stone-700/50 hover:bg-stone-800 text-stone-200 text-sm rounded-lg transition"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/cobb/icons/system/asset.png" alt="" className="h-5 w-5 object-contain" />
          New asset
        </Link>
      </div>

      {tiles.length === 0 ? (
        <div className="rounded-2xl border border-stone-700/50 bg-stone-900/40 p-8 text-center">
          <p className="text-sm text-stone-400">
            No assets tracked yet. Use <strong>+ Add → Asset</strong> to add a house, car, or any
            other thing you own. Once it&rsquo;s here it&rsquo;ll roll up into your Net Worth card too.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map((t) => (
            <AssetTile key={t.id} tile={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function AssetTile({ tile }: { tile: {
  id: string
  title: string
  kind: string | null
  currentBalanceCents: number | null
  balanceAsOf: Date | null
  thumbFileId: string | null
  thumbOffsetX: number
  thumbOffsetY: number
  thumbScale: number
  ownerName: string | null
} }) {
  const asOf = tile.balanceAsOf
    ? new Date(tile.balanceAsOf).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <Link
      href={`/entries/${tile.id}`}
      className="group block rounded-2xl border border-stone-700/50 bg-stone-900/40 hover:border-emerald-600/40 hover:bg-stone-900/60 transition overflow-hidden"
    >
      <div className="relative h-40 w-full bg-stone-950 border-b border-stone-800 overflow-hidden">
        {tile.thumbFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${tile.thumbFileId}?preview=1`}
            alt=""
            className="h-full w-full object-cover"
            style={{
              objectPosition: `${tile.thumbOffsetX}% ${tile.thumbOffsetY}%`,
              transform: `scale(${tile.thumbScale})`,
              transformOrigin: `${tile.thumbOffsetX}% ${tile.thumbOffsetY}%`,
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/cobb/icons/system/asset.png" alt="" className="h-16 w-16 object-contain opacity-60" />
          </div>
        )}
        {tile.kind && (
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-[0.18em] font-semibold text-emerald-200 bg-emerald-950/70 border border-emerald-800/60 rounded-full px-2 py-0.5">
            {tile.kind}
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-stone-100 truncate group-hover:text-white transition">{tile.title}</p>
        <p
          className="text-lg font-bold text-stone-100 tabular-nums leading-tight"
          style={{ textShadow: '0 0 12px rgba(16,185,129,0.45)' }}
        >
          {tile.currentBalanceCents != null ? formatCents(tile.currentBalanceCents) : '—'}
        </p>
        {asOf && <p className="text-[11px] text-stone-500">as of {asOf}</p>}
      </div>
    </Link>
  )
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function numOr(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
