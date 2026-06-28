'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { APP_NAME, APP_TAGLINE } from '@/lib/branding'
import { AilencodeCredit } from './cobb-banner'
import { VISIBLE_GUIDE_PROFILES } from '@/lib/dead-now-what-config'
import { AddMenuGrid } from './add-menu-grid'
import { CategoriesOverlay } from './categories-overlay'


function CatIcon({ img, active }: { img: string; active: boolean }) {
  return (
    <img
      src={img}
      width={32}
      height={32}
      alt=""
      className={clsx('object-contain shrink-0 rounded-md brightness-125 saturate-110', !active && 'opacity-95')}
    />
  )
}

interface DbCategory {
  id: string
  name: string
  slug: string
  icon: string | null
}

interface SidebarProps {
  role: string
  userName?: string | null
  categories: DbCategory[]
  /** Surfaced as a small green badge on the Messages nav item — replaces
   *  the floating-avatar unread dot now that UserMenu is hidden. */
  unreadCount?: number
}

export function Sidebar({ role, categories, unreadCount = 0 }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  // Sidebar search — submit on Enter, navigate to /search?q=…
  const [searchQ, setSearchQ] = useState('')
  // Toggles the desktop "what do you want to add?" overlay. Mirrors the
  // mobile +Add bottom-sheet so a desktop user gets the same one-tap
  // pick-an-affordance flow instead of being routed straight to
  // /entries/new and having to choose entry type on that page.
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  // Auto-close on route changes (clicking a tile navigates away).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the URL bar (external system)
    setAddMenuOpen(false)
  }, [pathname])
  // Categories overlay starts closed. The button below highlights when
  // the user is currently on /categories/* so the active context is
  // visible even without the overlay open.
  const onCategoryPage = pathname.startsWith('/categories/')
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  // Route-change auto-close so the overlay dismisses after the user
  // picks a category (mirrors the AddMenu auto-close).
  useEffect(() => {
    setCategoriesOpen(false)
  }, [pathname])
  // "More" collapses Subscriptions / Vault Guide / Eggs. Auto-opens
  // when the user is already viewing one of those routes — same trick
  // categoriesOpen uses to keep siblings visible.
  const onMoreRoute =
    pathname.startsWith('/subscriptions') ||
    pathname.startsWith('/reconcile') ||
    pathname.startsWith('/guide')
  const [moreOpen, setMoreOpen] = useState(onMoreRoute)

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  // Close any open overlay when the user clicks anywhere inside the
  // sidebar. Critical for "tap Home from /dashboard with +Add open":
  // pathname doesn't change → the pathname-change useEffect doesn't
  // fire → overlay would otherwise stay open. We attach this on the
  // <aside> via React's onClick (event delegation), so we skip the
  // two buttons that EXPECT to toggle an overlay (+Add launcher and
  // Categories launcher) by checking the event target. Link clicks
  // continue to navigate normally.
  function handleSidebarClick(e: React.MouseEvent<HTMLElement>) {
    const target = e.target as HTMLElement
    // Don't fire on clicks inside the two overlay-launcher buttons —
    // those want to toggle, not auto-close.
    if (target.closest('[data-overlay-launcher]')) return
    if (addMenuOpen) setAddMenuOpen(false)
    if (categoriesOpen) setCategoriesOpen(false)
  }

  return (
    <>
      {/* Desktop "what do you want to add?" overlay. Same option grid as
          the mobile bottom-sheet (AddMenuGrid). Click-outside / Esc /
          tile-tap all close it; tile-tap also navigates. */}
      {addMenuOpen && (
        <AddMenuOverlay onClose={() => setAddMenuOpen(false)} />
      )}
      {/* Categories overlay — same blurred-backdrop pattern as the +Add
          popup. Replaces the old inline drawer that crammed every
          category into the sidebar rail. */}
      {categoriesOpen && (
        <CategoriesOverlay categories={categories} onClose={() => setCategoriesOpen(false)} />
      )}
    {/* z-[70] keeps the sidebar above the AddMenu + Categories overlays
        (both at z-[60]) so Home and the other nav items stay clickable
        while a popup is open. The overlay's pathname-change effect then
        auto-closes the popup after the nav. Without this, the overlay
        backdrop swallowed sidebar clicks and Home felt "broken." */}
    <aside
      onClick={handleSidebarClick}
      className="hidden md:flex relative z-[70] flex-col w-64 min-h-screen bg-stone-950/95 border-r border-stone-800 shadow-2xl shadow-black/30"
    >
      {/* Logo — animals crest on the left + the CFV wordmark on the
          right (restored). */}
      <div className="px-5 py-5 border-b border-stone-800">
        <div className="flex items-center gap-3">
          <img
            src="/icons/cobb/cfv-animals-logo-real-no-smile.png"
            width={76}
            height={76}
            alt={APP_NAME}
            className="object-contain shrink-0 select-none rounded brightness-110"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/cfv.png"
            alt={APP_NAME}
            height={76}
            className="block h-[76px] w-auto object-contain shrink-0"
          />
        </div>
        <div className="mt-3 text-[11px] italic text-stone-400 leading-snug text-center">
          {APP_TAGLINE}
        </div>
      </div>

      {/* Search — inline form, submits to /search?q=… on Enter */}
      <div className="px-3 py-3 border-b border-stone-800">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const q = searchQ.trim()
            if (!q) return
            router.push(`/search?q=${encodeURIComponent(q)}`)
            setSearchQ('')
          }}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-stone-900/60 border border-stone-700/60 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20 transition"
        >
          <img
            src="/icons/cobb/icons/system/search.png"
            width={26}
            height={26}
            alt=""
            className="object-contain shrink-0 rounded brightness-125 saturate-110 opacity-95"
          />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search vault…"
            className="flex-1 min-w-0 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-none"
          />
        </form>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        <NavItem href="/dashboard" img="/icons/cobb/icons/system/home_like2.png" label="Home" active={isActive('/dashboard')} />
        {/* "Add entry" used to deep-link to /entries/new — but the user has
            to pick the type on the next page anyway, so swap it for a
            button that opens the same "what do you want to add?" overlay
            the mobile +Add bottom-sheet uses. One sidebar click → grid of
            affordances → land directly on the right form. */}
        <AddNavButton onClick={() => setAddMenuOpen(true)} active={addMenuOpen} launcher />
        <NavItem href="/ask" img="/icons/cobb/icons/brands/claude2.png" label="Ask the vault" active={isActive('/ask')} />
        <NavItem href="/notes" img="/icons/cobb/icons/system/notes2.png" label="Notes" active={isActive('/notes')} />
        <NavItem href="/todos" img="/icons/cobb/icons/system/to_do.png" label="To Do" active={isActive('/todos')} />

        {/* Categories — opens the shared CategoriesOverlay popup
            (centered modal, blurred backdrop) instead of an inline
            drawer that used to balloon the sidebar height. Stays
            highlighted when the user is currently on /categories/* so
            the active context is obvious without the drawer being
            open. */}
        <button
          type="button"
          onClick={() => setCategoriesOpen(true)}
          aria-expanded={categoriesOpen}
          data-overlay-launcher="1"
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
            'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60',
            onCategoryPage && 'text-stone-200',
          )}
        >
          <img
            src="/icons/cobb/icons/brands/github.png"
            width={32}
            height={32}
            alt=""
            className="object-contain shrink-0 rounded-md brightness-125 saturate-110 opacity-95"
          />
          <span className="flex-1 text-left">Categories</span>
        </button>

        {/* My Vault — personal items, all non-readonly users. Sits in
            the primary group (no heading) so it's the obvious
            destination after Home/Ask/Notes. */}
        {role !== 'readonly' && (
          <NavItem
            href="/my-vault"
            img="/icons/cobb/icons/system/lockvault.png"
            label="My Vault"
            active={isActive('/my-vault')}
          />
        )}
        <NavItem
          href="/cards"
          img="/icons/cobb/icons/system/creditcard.png"
          label="Cards"
          active={isActive('/cards')}
        />
        {/* /apps — dedicated list of app_login entries (Spotify, banking
            apps, etc.). Sits next to Cards/Assets so the entry-type
            destinations cluster together. */}
        <NavItem
          href="/apps"
          img="/icons/cobb/icons/system/app.png"
          label="Apps"
          active={isActive('/apps')}
        />
        <NavItem
          href="/assets"
          img="/icons/cobb/icons/system/asset.png"
          label="Assets"
          active={isActive('/assets')}
        />

        {/* Plan — meal plan, recipes, calendar, IDNW. The forward-
            looking destinations. */}
        <div className="pt-3 pb-1 px-2">
          <span className="cv-kicker">Plan</span>
        </div>
        <NavItem href="/meal-plan" img="/icons/cobb/icons/Recipes/meal_pla.png" label="Meal plan" active={isActive('/meal-plan')} />
        <NavItem href="/recipes" img="/icons/cobb/icons/Recipes/recipes_book.png" label="Recipe Book" active={isActive('/recipes')} />
        <NavItem href="/calendar" img="/icons/cobb/icons/system/recurring.png" label="Recurring Bills" active={isActive('/calendar')} />
        {VISIBLE_GUIDE_PROFILES.map((profile) => (
          <NavItem
            key={profile.key}
            href={profile.route}
            img="/icons/cobb/icons/system/IDNW.png"
            label="IDNW?"
            active={pathname === profile.route}
          />
        ))}

        {/* Family — messages / contacts / capsules / letters. Messages
            wears the unread badge so it pops. */}
        <div className="pt-3 pb-1 px-2">
          <span className="cv-kicker">Family</span>
        </div>
        <NavItem
          href="/messages"
          img="/icons/cobb/icons/system/messages.png"
          label="Messages"
          active={isActive('/messages')}
          badge={unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : undefined}
        />
        <NavItem href="/contacts" img="/icons/cobb/icons/system/contacts.png" label="Contacts" active={isActive('/contacts')} />
        <NavItem href="/capsules" img="/icons/cobb/icons/system/add_time_capsule.png" label="Time Capsules" active={isActive('/capsules')} />
        <NavItem href="/letters" img="/icons/cobb/icons/system/dad_love_letters.png" label="Family Letters" active={isActive('/letters')} />
        <NavItem href="/locate" img="/icons/cobb/icons/system/locate.png" label="Where Is It?" active={isActive('/locate')} />

        {/* More — low-frequency stuff behind a collapse. Auto-opens
            when the user is already viewing one of these routes (same
            pattern as categoriesOpen). */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={clsx(
            'mt-2 w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
            'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60',
            onMoreRoute && 'text-stone-200',
          )}
          aria-expanded={moreOpen}
        >
          <ChevronRight size={16} className={clsx('shrink-0 text-stone-500 transition-transform', moreOpen && 'rotate-90')} />
          <span className="flex-1 text-left">More</span>
        </button>
        {moreOpen && (
          <div className="ml-3 pl-2 border-l border-stone-800 space-y-0.5">
            <NavItem href="/subscriptions" img="/icons/cobb/icons/system/recurring.png" label="Subscriptions" active={isActive('/subscriptions')} />
            <NavItem href="/reconcile" img="/icons/cobb/icons/system/recurring.png" label="Reconcile" active={isActive('/reconcile')} />
            <NavItem href="/guide" img="/icons/cobb/icons/system/guide.png" label="Vault Guide" active={isActive('/guide')} />
          </div>
        )}

        {/* Admin — adds Bulk Import surfacing for the local-only
            Vault Inbox sync (previously only reachable from /admin). */}
        {(role === 'superuser' || role === 'admin') && (
          <>
            <div className="pt-3 pb-1 px-2">
              <span className="cv-kicker">Admin</span>
            </div>
            {role === 'superuser' && (
              <NavItem
                href="/vault"
                img="/icons/cobb/icons/system/admin_vault2.png"
                label="Admin Vault"
                active={isActive('/vault')}
              />
            )}
            <NavItem href="/admin" img="/icons/cobb/icons/system/adminx.png" label="Admin Panel" active={isActive('/admin')} />
            <NavItem href="/import" img="/icons/cobb/icons/system/bulk_import.png" label="Bulk Import" active={isActive('/import')} />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-stone-800 p-3 space-y-0.5">
        <NavItem href="/settings" img="/icons/cobb/icons/system/settings.png" label="Settings" active={isActive('/settings')} />
        <AilencodeCredit />
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-stone-400 hover:text-red-400 hover:bg-stone-800 transition text-sm"
        >
          <img src="/icons/cobb/icons/system/sign_out.png" width={39} height={39} alt="" className="h-[39px] w-[39px] object-contain shrink-0 brightness-125 saturate-110" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
    </>
  )
}

// Sidebar version of mobile-nav's AddTab — same nav-row look as NavItem
// but renders a button (not a Link) so it can toggle the AddMenuOverlay
// without navigating away first.
function AddNavButton({ onClick, active, launcher }: { onClick: () => void; active: boolean; launcher?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      data-overlay-launcher={launcher ? '1' : undefined}
      className={clsx(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
        active
          ? 'bg-stone-800 text-stone-100 font-medium'
          : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60',
      )}
    >
      <img
        src="/icons/cobb/icons/system/add_password_blue.png"
        width={32}
        height={32}
        alt=""
        className="object-contain shrink-0 rounded-md brightness-125 saturate-110 opacity-95"
      />
      <span className="flex-1 text-left">Add entry</span>
    </button>
  )
}

// Centered desktop overlay for the +Add affordance grid. Click-outside,
// Escape, or tile-tap dismisses. Z-index sits above the sidebar (z-50)
// because the sidebar is z-default on desktop — z-60 keeps it above the
// FamilyPhotoOverlay too.
function AddMenuOverlay({ onClose }: { onClose: () => void }) {
  // Escape closes — same affordance the mobile bottom-sheet provides.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="hidden md:flex fixed inset-0 z-[60] items-center justify-center bg-black/75 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-br from-stone-900/95 to-black/95 shadow-2xl shadow-black/60 backdrop-blur-md p-4"
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500">
            What do you want to add?
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition"
          >
            <X size={16} />
          </button>
        </div>
        <AddMenuGrid onSelect={onClose} />
      </div>
    </div>
  )
}

function NavItem({
  href,
  icon: Icon,
  img,
  label,
  active,
  iconClassName,
  badge,
}: {
  href: string
  icon?: React.ElementType
  img?: string
  label: string
  active: boolean
  iconClassName?: string
  /** Small text badge on the right (e.g. unread message count). */
  badge?: string
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition',
        active
          ? 'bg-stone-800 text-stone-100 font-medium'
          : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/60'
      )}
    >
      {img ? (
        <CatIcon img={img} active={active} />
      ) : Icon ? (
        <Icon size={16} className={active ? 'text-emerald-400' : iconClassName} />
      ) : null}
      <span className="flex-1 truncate">{label}</span>
      {badge && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-stone-950">
          {badge}
        </span>
      )}
    </Link>
  )
}
