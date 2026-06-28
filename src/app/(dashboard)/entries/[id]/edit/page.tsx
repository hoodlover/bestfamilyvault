import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, categories, subcategories, entryFavorites, users } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { EditEntryForm } from '@/components/ui/edit-entry-form'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { decryptEntryFields } from '@/lib/crypto'

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect(`/entries/${id}`)

  const rawEntry = await db
    .select()
    .from(entries)
    .where(eq(entries.id, id))
    .then((r) => r[0])

  if (!rawEntry) notFound()
  if (rawEntry.isPrivate && session.user.role !== 'superuser') redirect('/dashboard')
  // isPersonal is strictly owner-only — superuser does not bypass. The kids
  // are adults; their personal items belong to them and only them.
  if (rawEntry.isPersonal && rawEntry.createdBy !== session.user.id) {
    redirect('/dashboard')
  }

  // Decrypt sensitive fields so the form populates with plaintext values.
  const entry = decryptEntryFields(rawEntry)

  const isSuperuser = session.user.role === 'superuser'

  // Per-user favorite state for the Favorite checkbox default. Each family
  // member sees their own star, not whatever the original creator set.
  const userFavorited = await db
    .select({ id: entryFavorites.id })
    .from(entryFavorites)
    .where(and(eq(entryFavorites.userId, session.user.id), eq(entryFavorites.entryId, id)))
    .then((r) => r.length > 0)

  const [allCategories, allSubs, ccRows, familyRows] = await Promise.all([
    db.select().from(categories).orderBy(categories.sortOrder),
    db.select().from(subcategories).orderBy(subcategories.sortOrder),
    db
      .select({ id: entries.id, title: entries.title, cardNetwork: entries.cardNetwork })
      .from(entries)
      .where(
        and(
          eq(entries.type, 'credit_card'),
          isSuperuser ? undefined : eq(entries.isPrivate, false),
          or(eq(entries.isPersonal, false), eq(entries.createdBy, session.user.id)),
        ),
      ),
    // Family profiles — used by the Asset edit form's Driver dropdown
    // when the entry kind is vehicular. Pulling id/name only keeps the
    // payload tiny; nothing else from the user row is needed here.
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
  ])
  const familyProfiles = familyRows.map((u) => ({
    id: u.id,
    name: u.name ?? u.email ?? 'Family member',
  }))

  // Subscriptions subcategory id, if seeded — controls whether the edit
  // form renders the "Paid with" dropdown.
  const finance = allCategories.find((c) => c.slug === 'finance')
  const subsSub = finance ? allSubs.find((s) => s.categoryId === finance.id && s.name === 'Subscriptions') : null

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/dashboard" className="hover:text-stone-300 transition">Dashboard</Link>
        <ChevronRight size={14} />
        <Link href={`/entries/${entry.id}`} className="hover:text-stone-300 transition truncate max-w-[200px]">
          {entry.title}
        </Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Edit</span>
      </nav>

      <EditEntryForm
        entry={entry}
        categories={allCategories}
        subcategories={allSubs}
        creditCards={ccRows.map((c) => ({ id: c.id, label: c.title, network: c.cardNetwork }))}
        subscriptionsSubcategoryId={subsSub?.id ?? null}
        isSuperuser={isSuperuser}
        userFavorited={userFavorited}
        familyProfiles={familyProfiles}
      />
    </div>
  )
}
