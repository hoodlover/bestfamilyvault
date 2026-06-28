import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { and, eq, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { entries } from '@/lib/db/schema'
import { decryptEntries } from '@/lib/crypto'
import { HelpPopout } from '@/components/ui/help-popout'

// /apps — dedicated list of every `app_login` entry the user can see.
// Mirrors the visibility rules from /cards: private = superuser only,
// personal = creator only. Stays deliberately minimal — title +
// username + URL host + edit link. Detail / reveal is one tap away on
// the entry page; no per-row password reveal here (this page is meant
// for browsing/finding, not for spraying credentials at a glance).

export default async function AppsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  const rawRows = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'app_login'),
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )
    .orderBy(entries.title)

  const apps = decryptEntries(rawRows)

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      {/* Mobile header — matches the compact treatment Cards / Receipts use. */}
      <div className="md:hidden flex items-center gap-2 mb-4">
        <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Apps</h1>
        <span className="text-xs font-mono text-stone-500">{apps.length}</span>
        <Link
          href="/entries/new?type=app_login"
          aria-label="Add app login"
          className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/addapp.png"
            width={40}
            height={40}
            alt=""
            className="h-10 w-10 object-contain"
          />
        </Link>
      </div>

      <div className="hidden md:flex items-center gap-3 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/app.png"
          alt=""
          width={48}
          height={48}
          className="object-contain shrink-0"
        />
        <h1 className="text-2xl font-bold text-stone-100">Apps</h1>
        <HelpPopout
          title="Apps"
          sections={[
            {
              heading: 'What is this',
              tips: [
                { title: 'Every app login in one place', description: 'Credentials for the apps you use — Spotify, Disney+, Hulu, banking apps, work apps — separate from website logins so the list stays scoped.' },
                { title: 'Same fields as a Password', description: 'Title, username, password, optional URL. Stored encrypted; revealed only on the entry detail page.' },
              ],
            },
            {
              heading: 'How to add',
              tips: [
                { title: '+ Add → App tile', description: 'The +Add menu (sidebar on desktop, bottom bar on mobile) has a dedicated App tile that pre-selects the app_login type.' },
                { title: 'From an existing login', description: 'Edit the entry and change its type — the data lifts straight over since the underlying shape is identical.' },
              ],
            },
          ]}
        />
      </div>
      <p className="hidden md:block text-stone-400 text-sm mb-4">
        App logins — mobile + desktop apps, separated from your website passwords. {apps.length} total.
      </p>

      <div className="hidden md:flex flex-wrap gap-2 mb-6">
        <Link
          href="/entries/new?type=app_login"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-600/50 text-emerald-100 text-sm font-medium transition"
        >
          <Plus size={14} />
          Add app login
        </Link>
      </div>

      {apps.length === 0 ? (
        <div className="text-center py-16 text-stone-500">
          <p className="text-4xl mb-3">📱</p>
          <p className="font-medium text-stone-400">No app logins yet.</p>
          <p className="text-sm mt-1">Tap the App tile in +Add (or the button above) to save your first one.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {apps.map((app) => {
            const host = safeHost(app.url)
            return (
              <Link
                key={app.id}
                href={`/entries/${app.id}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border bg-stone-800/60 border-stone-700/50 hover:border-stone-600 hover:bg-stone-800 transition"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/cobb/icons/system/app.png"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 object-contain shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-stone-100 truncate">{app.title}</div>
                  <div className="text-xs text-stone-500 truncate">
                    {app.username || <span className="text-stone-600">no username</span>}
                    {host && <span className="text-stone-600"> · {host}</span>}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Pulls the hostname out of a stored URL for the secondary row text.
// Falls back to null on anything that doesn't parse so we can render
// just the username with no trailing separator.
function safeHost(raw: string | null): string | null {
  if (!raw) return null
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
