import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, users } from '@/lib/db/schema'
import { Sidebar } from '@/components/ui/sidebar'
import { MobileNav } from '@/components/ui/mobile-nav'
import { BackGuard } from '@/components/ui/back-guard'
import { DemoBanner } from '@/components/ui/demo-banner'
import { UserMenu } from '@/components/ui/user-menu'
import { PWAInstallPrompt } from '@/components/ui/pwa-install-prompt'
import { PWAToolbar } from '@/components/ui/pwa-toolbar'
import { RefreshOnFocus } from '@/components/ui/refresh-on-focus'
import { getUnreadCount } from '@/lib/actions/messages'
import { getMyToolDrawerOrder } from '@/lib/actions/settings'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const [allCategories, me, unreadCount, toolDrawerOrder] = await Promise.all([
    db.select().from(categories).orderBy(categories.sortOrder),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .then((r) => r[0] ?? null),
    getUnreadCount(),
    getMyToolDrawerOrder(),
  ])

  // Avatar lives in a private blob; serve it via the proxy. Bust browser cache
  // when the user record changes (covers crop edits, removals, name changes).
  const avatarSrc = me?.image
    ? `/api/avatars/${me.id}?v=${me.updatedAt.getTime()}`
    : null

  return (
    // Print overrides on the shell: h-screen + overflow-hidden was clipping
    // the print output to one viewport's worth (root cause of Lance's
    // "only puts out 1 page" complaint). print:h-auto + print:overflow-visible
    // lets the browser paginate naturally over the full content.
    <div className="flex h-screen overflow-hidden vault-shell print:h-auto print:overflow-visible print:block">
      <div className="no-print contents">
        <BackGuard />
        <PWAInstallPrompt />
        <PWAToolbar />
        <RefreshOnFocus />
        <Sidebar role={session.user.role} userName={session.user.name} categories={allCategories} unreadCount={unreadCount} />
      </div>
      <main className="relative flex-1 overflow-y-auto print:overflow-visible print:h-auto">
        <div aria-hidden className="no-print pointer-events-none fixed inset-x-0 top-0 h-48 bg-gradient-to-b from-emerald-950/20 to-transparent" />
        <div className="no-print contents">
          <DemoBanner />
          <UserMenu
            name={me?.name ?? session.user.name ?? null}
            email={me?.email ?? session.user.email ?? null}
            image={avatarSrc}
            role={session.user.role}
            unreadCount={unreadCount}
          />
        </div>
        {/* 25px mobile top padding clears the floating user avatar
            (top-3 right-3, h-10) so content doesn't slide under it.
            The old top-left hamburger is gone in the mobile redesign —
            its slot is now the "Menu" tab in the bottom bar, which slides
            the tools drawer in from the left. 25px + each page's own
            p-4 (16px) puts content at ~41px from the top. Desktop
            unaffected (sidebar holds the left, centered content keeps
            clear of the avatar). */}
        <div className="print-keep pt-[25px] md:pt-0 pb-16 md:pb-0 print:pt-0 print:pb-0">
          {children}
        </div>
      </main>
      <div className="no-print contents">
        <MobileNav
          role={session.user.role}
          categories={allCategories}
          unreadCount={unreadCount}
          toolDrawerOrder={toolDrawerOrder}
        />
      </div>
    </div>
  )
}
