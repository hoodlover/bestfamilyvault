import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, files, users } from '@/lib/db/schema'
import { and, eq, or, inArray, like } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { HelpPopout } from '@/components/ui/help-popout'
import { CardsBrowser } from '@/components/ui/cards-browser'

export default async function CardsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  // Pull every credit-card and identity entry the user is allowed to see —
  // same visibility rules as the rest of the vault (private = superuser
  // only; personal = creator-only, superuser does NOT bypass). Ignores
  // category so a card filed anywhere shows up.
  const rawRows = await db
    .select()
    .from(entries)
    .where(
      and(
        inArray(entries.type, ['credit_card', 'identity'] as const),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(entries.updatedAt)

  const rows = decryptEntries(rawRows)

  // Owner avatar/name lookup — entries.createdBy → users.name.
  const ownerIds = Array.from(new Set(rows.map((r) => r.createdBy).filter(Boolean) as string[]))
  const owners = ownerIds.length === 0
    ? []
    : await db
        .select({ id: users.id, name: users.name, email: users.email, image: users.image })
        .from(users)
        .where(inArray(users.id, ownerIds))
  const ownerById = new Map(owners.map((o) => [o.id, { name: o.name ?? o.email ?? 'Family', image: o.image }]))

  // First image attachment per entry — used as the tile thumbnail when the
  // user scanned the card with the camera. One query covers every entry.
  // We surface the FILE ID (not the raw blob URL) so the browser fetches
  // via /api/files/[id]?preview=1, which auth-checks + proxies the private
  // Vercel Blob. Embedding blobUrl directly would 401 in the user's <img>
  // because the BLOB_READ_WRITE_TOKEN never ships to the client.
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

  // Pick the OLDEST image per entry — that's typically the original
  // scan from the new-entry flow (subsequent uploads would be later).
  const thumbByEntry = new Map<string, string>()
  for (const f of imageFiles) {
    if (!f.entryId) continue
    // Private attachments stay invisible to non-superusers — match the
    // entry-detail page's behavior.
    if (f.isPrivate && !isSuperuser) continue
    if (!thumbByEntry.has(f.entryId)) thumbByEntry.set(f.entryId, `/api/files/${f.id}?preview=1`)
  }

  // Shape the rows for the client — only what the UI needs, decrypted.
  const cards = rows.map((r) => ({
    id: r.id,
    type: r.type as 'credit_card' | 'identity',
    title: r.title,
    cardholderName: r.cardholderName,
    cardNumber: r.cardNumber,
    cardNetwork: r.cardNetwork,
    expiryDate: r.expiryDate,
    firstName: r.firstName,
    lastName: r.lastName,
    passport: r.passport,
    driversLicense: r.driversLicense,
    ownerName: r.createdBy ? ownerById.get(r.createdBy)?.name ?? null : null,
    ownerImage: r.createdBy ? ownerById.get(r.createdBy)?.image ?? null : null,
    thumbUrl: thumbByEntry.get(r.id) ?? null,
  }))

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      {/* Compact mobile header (md:hidden) — matches the utility-page
          chrome on Receipts / Recipes / Notes / Subscriptions. The
          desktop layout with the 48px tile icon + HelpPopout stays put
          below. Add-card affordances are also dropped on mobile (the
          Add tab in the bottom bar covers it). */}
      <div className="md:hidden flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Cards</h1>
        <span className="text-xs font-mono text-stone-500">{cards.length}</span>
        <Link
          href="/entries/new?type=credit_card"
          aria-label="Add credit card"
          className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/creditcard.png"
            width={40}
            height={40}
            alt=""
            className="h-10 w-10 object-contain"
            style={{ filter: 'brightness(1.08) saturate(1.05)' }}
          />
        </Link>
      </div>

      <div className="hidden md:flex items-center gap-3 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/creditcard.png"
          alt=""
          width={48}
          height={48}
          className="object-contain shrink-0"
        />
        <h1 className="text-2xl font-bold text-stone-100">Cards</h1>
        <HelpPopout
          title="Cards"
          sections={[
            {
              heading: 'What is this',
              tips: [
                { title: 'Every card in one place', description: 'Credit cards and identity docs (driver\'s license, passport, ID) the vault knows about — across categories. Helpful when you don\'t remember the title or it\'s spelled differently than expected.' },
                { title: 'Photo thumbnails', description: 'If you scanned the card with the camera, the photo shows up on the tile. No scan? Generic icon.' },
                { title: 'Expiry badge', description: 'Cards expired or expiring within 60 days get a red badge.' },
              ],
            },
            {
              heading: 'Search tips',
              tips: [
                { title: 'Free-text', description: 'The search box matches title, cardholder, network, last-4 of the card number, DL #, and passport #.' },
                { title: 'Visibility', description: 'Same rules as the rest of the vault — personal cards are owner-only; private cards are superuser-only.' },
              ],
            },
          ]}
        />
      </div>
      <p className="hidden md:block text-stone-400 text-sm mb-4">
        Browse every credit card and ID in the vault. {cards.length} total.
      </p>

      {/* Add-card affordances — split so each lands on the scanner-equipped
          form for its type. The +Add popup also has these; surfacing them
          here means users on /cards don't have to leave for the bottom
          nav to add another one. Hidden on mobile (the new compact header
          carries one icon-link to the credit-card form, and the global
          +Add tab handles the ID flow). */}
      <div className="hidden md:flex flex-wrap gap-2 mb-6">
        <Link
          href="/entries/new?type=credit_card"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-600/50 text-emerald-100 text-sm font-medium transition"
        >
          <Plus size={14} />
          Add credit card
        </Link>
        <Link
          href="/entries/new?type=identity"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 text-sm font-medium transition"
        >
          <Plus size={14} />
          Add ID / passport
        </Link>
      </div>

      <CardsBrowser cards={cards} />
    </div>
  )
}
