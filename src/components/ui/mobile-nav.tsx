'use client'

// Bottom tab bar (mobile). 5 slots: Home, Find, Add (raised center),
// My Vault, Menu. The "Menu" tab slides the MobileToolsDrawer in from the
// left over the current screen — replacing the old fixed top-left
// hamburger entirely. The Add tab opens a sheet of "what to add" tiles.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { MobileToolsDrawer } from './mobile-tools-drawer'
import { AddMenuGrid } from './add-menu-grid'

interface DbCategory {
  id: string
  name: string
  slug: string
  icon: string | null
}

interface MobileNavProps {
  role: string
  categories: DbCategory[]
  /** Passed through to the drawer's Messages tile as a count pill. */
  unreadCount?: number
  /** User's saved tile order for the drawer. Empty array → default. */
  toolDrawerOrder?: readonly string[]
}

export function MobileNav({ role, categories, unreadCount = 0, toolDrawerOrder = [] }: MobileNavProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const entryType = searchParams.get('type')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Auto-close both menus whenever the route changes. The previous
  // version compared a stored pathname to usePathname() — fragile if
  // pathname changes mid-click, and intermittently caused the sheet to
  // open and immediately close (user reported having to pull-to-refresh
  // before the Add button worked again). Closing the menus on
  // pathname change IS syncing with an external system (the URL bar),
  // so the lint warning here doesn't apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the URL bar (external system) is a legitimate effect use
    setAddMenuOpen(false)
    setDrawerOpen(false)
  }, [pathname])

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  return (
    <>
      {addMenuOpen && (
        <AddMenuSheet onClose={() => setAddMenuOpen(false)} />
      )}
      <MobileToolsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        role={role}
        categories={categories}
        unreadCount={unreadCount}
        initialOrder={toolDrawerOrder}
      />
      {/* Event delegation: clicking ANY nav tab also dismisses the +Add
          sheet (and the Menu drawer). Without this, tapping Home from
          /dashboard with the sheet open did nothing visible — the Link
          fired but pathname didn't change, so the auto-close useEffect
          missed it. Skip elements marked data-overlay-launcher so the
          Add tab itself can still toggle. */}
      <nav
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('[data-overlay-launcher]')) return
          if (addMenuOpen) setAddMenuOpen(false)
          if (drawerOpen) setDrawerOpen(false)
        }}
        className="fixed bottom-0 left-0 right-0 z-50 grid grid-cols-5 md:hidden items-end bg-stone-950/95 backdrop-blur border-t border-stone-800 px-1 pb-safe"
      >
        <TabItem href="/dashboard" img="/icons/cobb/icons/system/home_like2.png" label="Home" active={isActive('/dashboard')} />
        <TabItem href="/search" img="/icons/cobb/icons/system/search.png" label="Find" active={isActive('/search')} />
        <AddTab
          img="/icons/cobb/icons/system/add_password_blue.png"
          label="Add"
          active={(pathname === '/entries/new' && entryType !== 'document') || addMenuOpen}
          onClick={() => {
            // Dismiss any focused input (e.g. the search field) so the
            // mobile keyboard hides before the add-sheet animates in.
            const el = document.activeElement
            if (el && el instanceof HTMLElement && typeof el.blur === 'function') el.blur()
            setAddMenuOpen((v) => !v)
          }}
        />
        <TabItem href="/my-vault" img="/icons/cobb/icons/system/lockvault.png" label="My Vault" active={isActive('/my-vault')} />
        <MenuTab
          img="/icons/cobb/icons/system/menu.png"
          label="Menu"
          active={drawerOpen}
          onClick={() => {
            const el = document.activeElement
            if (el && el instanceof HTMLElement && typeof el.blur === 'function') el.blur()
            setDrawerOpen((v) => !v)
          }}
        />
      </nav>
    </>
  )
}

function TabItem({
  href,
  img,
  label,
  active,
}: {
  href: string
  img: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex flex-col items-center justify-end gap-0.5 py-2 min-w-0 transition',
        active ? 'text-emerald-300' : 'text-stone-400 hover:text-stone-200'
      )}
    >
      <span className="flex h-[54px] w-[54px] items-center justify-center transition">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          width={45}
          height={45}
          alt=""
          className={clsx('object-contain rounded brightness-125', active ? 'opacity-100' : 'opacity-80')}
        />
      </span>
      <span className={clsx('text-[10px] font-medium leading-none truncate max-w-full', active ? 'text-emerald-300' : 'text-stone-400')}>
        {label}
      </span>
    </Link>
  )
}

function AddTab({
  img,
  label,
  active,
  onClick,
}: {
  img: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={active}
      data-overlay-launcher="1"
      className={clsx(
        'flex flex-col items-center justify-end gap-0.5 py-2 min-w-0 transition',
        active ? 'text-emerald-300' : 'text-stone-400 hover:text-stone-200'
      )}
    >
      <span className="flex h-14 w-14 items-center justify-center -mt-4 transition">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          width={40}
          height={40}
          alt=""
          className="object-contain rounded opacity-100 brightness-125"
        />
      </span>
      <span className={clsx('text-[10px] font-medium leading-none truncate max-w-full', active ? 'text-emerald-300' : 'text-stone-400')}>
        {label}
      </span>
    </button>
  )
}

// "Menu" tab — visually a peer of TabItem but it toggles the drawer
// instead of navigating. Separate from AddTab so its accessible name and
// active-state semantics can be specific to "open/close the menu."
function MenuTab({
  img,
  label,
  active,
  onClick,
}: {
  img: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? 'Close menu' : 'Open menu'}
      aria-expanded={active}
      data-overlay-launcher="1"
      className={clsx(
        'flex flex-col items-center justify-end gap-0.5 py-2 min-w-0 transition',
        active ? 'text-emerald-300' : 'text-stone-400 hover:text-stone-200'
      )}
    >
      <span className="flex h-[54px] w-[54px] items-center justify-center transition">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          width={45}
          height={45}
          alt=""
          className={clsx('object-contain rounded brightness-125', active ? 'opacity-100' : 'opacity-80')}
        />
      </span>
      <span className={clsx('text-[10px] font-medium leading-none truncate max-w-full', active ? 'text-emerald-300' : 'text-stone-400')}>
        {label}
      </span>
    </button>
  )
}

function AddMenuSheet({ onClose }: { onClose: () => void }) {
  // Close on Escape — useful on tablets with attached keyboards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Guard the backdrop tap-to-close for the first 200ms after mount.
  // On mobile, the same tap that opens the sheet can synthesize a ghost
  // click on the freshly-mounted backdrop — sheet appeared for a frame
  // then closed, which the user perceived as "the Add button didn't open."
  const [canClose, setCanClose] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setCanClose(true), 200)
    return () => clearTimeout(id)
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 md:hidden bg-black/70 backdrop-blur-sm"
      onClick={() => { if (canClose) onClose() }}
    >
      <div
        // bottom offset = nav height (~96px on tap-target spec) plus the
        // device safe-area-inset. Without the inset, iPhones with a home
        // indicator put the bottom row of tiles UNDER the nav, and since
        // the nav is z-50 (above this z-40 popup) the nav swallows those
        // taps — symptom was "+Add popup feels frozen on certain tiles."
        className="absolute left-0 right-0 px-6 pb-2 pt-6"
        style={{ bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-stone-900/95 to-black/95 shadow-[0_-12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md p-3">
          <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500 text-center mb-3">
            What do you want to add?
          </p>
          <AddMenuGrid onSelect={onClose} />
        </div>
      </div>
    </div>
  )
}
