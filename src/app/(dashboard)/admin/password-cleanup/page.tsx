import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { and, eq, or, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'
import { decryptEntries } from '@/lib/crypto'
import { PasswordCleanupList } from '@/components/ui/password-cleanup-list'

export default async function PasswordCleanupPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') redirect('/dashboard')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  // Pull every login the caller can see — same visibility model as the
  // rest of the app. Categories are joined client-side via a small lookup
  // so we don't carry the full category row across the wire.
  const rows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'login'),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(asc(entries.title))

  const decrypted = decryptEntries(rows)
  const catRows = await db.select({ id: categories.id, name: categories.name }).from(categories)
  const catName = new Map(catRows.map((c) => [c.id, c.name]))

  const logins = decrypted.map((e) => ({
    id: e.id,
    title: e.title,
    username: e.username ?? null,
    password: e.password ?? null,
    url: e.url ?? null,
    category: catName.get(e.categoryId) ?? '',
    categoryId: e.categoryId,
    updatedAt: e.updatedAt?.toISOString() ?? null,
  }))

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 no-print">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ChevronLeft size={14} /> back to admin
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-red-600/10 border border-red-600/20">
          <Trash2 size={20} className="text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Password cleanup</h1>
          <p className="text-sm text-stone-400 mt-0.5">
            Every login in the vault, sorted for easy duplicate-spotting. Tick the rows you want
            gone, then delete — a CSV snapshot downloads first so you have a one-shot recovery handle.
          </p>
        </div>
      </div>

      <p className="text-xs text-stone-500 mb-6 leading-relaxed">
        <strong className="text-stone-300">{logins.length}</strong> total logins. Passwords are masked
        by default — tap the eye on any row, or use the <em>Reveal all</em> toggle for fast scanning.
        Duplicates are flagged automatically when two rows share the same normalized domain + username.
      </p>

      <PasswordCleanupList logins={logins} />
    </div>
  )
}
