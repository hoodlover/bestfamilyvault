'use client'

// Slide-up bottom sheet triggered by the "Menu" tab on the mobile bottom
// bar. Secondary destinations now live in the same full tile grid; Categories
// opens a second in-sheet icon grid instead of an inner "More" section.

import { usePathname, useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getCategoryIcon, getCategoryLabel } from '@/lib/category-presentation'
import { isGuideSlug } from '@/lib/dead-now-what-config'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { saveToolDrawerOrder } from '@/lib/actions/settings'

interface DbCategory {
  id: string
  name: string
  slug: string
  icon: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  role: string
  categories: DbCategory[]
  unreadCount?: number
  initialOrder?: readonly string[]
}

interface Tile {
  key: string
  label: string
  icon: string
  href: string
  badge?: string
}

function buildTiles(unreadCount: number, role: string): Tile[] {
  const unreadPill =
    unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : undefined
  const isAdmin = role === 'superuser' || role === 'admin'
  const isSuperuser = role === 'superuser'
  const tiles: Tile[] = [
    { key: 'meal-plan', label: 'Meal plan', icon: '/icons/cobb/icons/Recipes/meal_pla.png', href: '/meal-plan' },
    { key: 'grocery', label: 'Grocery list', icon: '/icons/cobb/icons/Recipes/vegetables.png', href: '/meal-plan/grocery' },
    { key: 'recipes', label: 'Recipe book', icon: '/icons/cobb/icons/Recipes/recipes_book.png', href: '/recipes' },
    { key: 'upcoming-bills', label: 'Recurring Bills', icon: '/icons/cobb/icons/system/recurring.png', href: '/calendar' },
    { key: 'messages', label: 'Messages', icon: '/icons/cobb/icons/system/messages.png', href: '/messages', badge: unreadPill },
    { key: 'contacts', label: 'Contacts', icon: '/icons/cobb/icons/system/contacts.png', href: '/contacts' },
    { key: 'capsules', label: 'Time capsules', icon: '/icons/cobb/icons/system/add_time_capsule.png', href: '/capsules' },
    { key: 'letters', label: 'Family Letters', icon: '/icons/cobb/icons/system/dad_love_letters.png', href: '/letters' },
    { key: 'locate', label: 'Where Is It?', icon: '/icons/cobb/icons/system/locate.png', href: '/locate' },
    { key: 'receipts', label: 'Receipts', icon: '/icons/cobb/icons/Finances/receipts.png', href: '/receipts' },
    { key: 'cards', label: 'Cards', icon: '/icons/cobb/icons/system/creditcard.png', href: '/cards' },
    { key: 'apps', label: 'Apps', icon: '/icons/cobb/icons/system/app.png', href: '/apps' },
    { key: 'assets', label: 'Assets', icon: '/icons/cobb/icons/system/asset.png', href: '/assets' },
    { key: 'taxes', label: 'Taxes', icon: '/icons/cobb/icons/Finances/taxes.png', href: '/reconcile' },
    { key: 'notes', label: 'Notes', icon: '/icons/cobb/icons/system/notes2.png', href: '/notes' },
    { key: 'todos', label: 'To Do', icon: '/icons/cobb/icons/system/to_do.png', href: '/todos' },
    { key: 'idnw', label: 'IDNW?', icon: '/icons/cobb/icons/system/IDNW.png', href: '/now-what' },
    { key: 'guide', label: 'Vault guide', icon: '/icons/cobb/icons/system/guide.png', href: '/guide' },
    { key: 'settings', label: 'Settings', icon: '/icons/cobb/icons/system/settings.png', href: '/settings' },
    { key: 'ask', label: 'Ask the vault', icon: '/icons/cobb/icons/brands/claude2.png', href: '/ask' },
    { key: 'categories', label: 'Categories', icon: '/icons/cobb/icons/brands/github.png', href: '/categories' },
  ]

  if (isSuperuser) {
    tiles.push({ key: 'admin-vault', label: 'Admin Vault', icon: '/icons/cobb/icons/system/admin_vault2.png', href: '/vault' })
  }
  // Admin Panel + Bulk Import intentionally NOT in the mobile drawer —
  // Lance pulled them so the drawer stays focused on day-to-day tools.
  // Reach those routes from /admin or the sidebar on desktop. isAdmin
  // gate still applies on the sidebar's Admin section so role check
  // hasn't disappeared.
  void isAdmin

  return tiles
}

function applyOrder(defaultTiles: Tile[], savedOrder: readonly string[]): Tile[] {
  const byKey = new Map(defaultTiles.map((t) => [t.key, t]))
  const result: Tile[] = []
  const seen = new Set<string>()
  for (const key of savedOrder) {
    const tile = byKey.get(key)
    if (!tile || seen.has(key)) continue
    result.push(tile)
    seen.add(key)
  }
  for (const tile of defaultTiles) {
    if (!seen.has(tile.key)) result.push(tile)
  }
  return result
}

export function MobileToolsDrawer({ open, onClose, role, categories, unreadCount = 0, initialOrder = [] }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [searchQ, setSearchQ] = useState('')
  const [categoryQ, setCategoryQ] = useState('')
  const [showCategories, setShowCategories] = useState(false)

  const defaultTiles = buildTiles(unreadCount, role)
  const [orderedKeys, setOrderedKeys] = useState<string[]>(() =>
    applyOrder(defaultTiles, initialOrder).map((t) => t.key),
  )
  const tileByKey = new Map(defaultTiles.map((t) => [t.key, t]))
  const orderedTiles = orderedKeys
    .map((k) => tileByKey.get(k))
    .filter((t): t is Tile => !!t)
  for (const t of defaultTiles) {
    if (!orderedKeys.includes(t.key)) orderedTiles.push(t)
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
  )

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrderedKeys((prev) => {
      const oldIndex = prev.indexOf(String(active.id))
      const newIndex = prev.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      saveToolDrawerOrder(next).then((res) => {
        if (res?.error) console.warn('[tools-drawer] save failed:', res.error)
      })
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) return
    queueMicrotask(() => {
      setShowCategories(false)
      setCategoryQ('')
    })
  }, [open])

  if (!open) return null

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)

  const categoryTiles = categories
    .filter((cat) => !isGuideSlug(cat.slug))
    .filter((cat) => {
      const q = categoryQ.trim().toLowerCase()
      if (!q) return true
      return getCategoryLabel(cat.slug, cat.name).toLowerCase().includes(q)
    })

  function go(href: string) {
    onClose()
    router.push(href)
  }

  return (
    <>
      {/* Backdrop sits BELOW the nav (z-40 vs nav's z-50) so the nav
          draws on top of it untouched. Previously used z-[80] with a
          bottom-16 cutout — but the nav is taller than 64px on iOS once
          safe-area-inset-bottom is added, so the top ~20px of the nav
          icons were getting covered by a black bar. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="cv-drawer-backdrop md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]"
      />
      {/* Sheet bottom offset includes safe-area-inset-bottom so the panel
          doesn't overlap the top of the nav on iPhones with a home
          indicator. 96px ≈ nav vertical chrome on Android; +safe handles
          iOS. */}
      <aside
        className="cv-sheet md:hidden fixed inset-x-0 z-[90] flex flex-col max-h-[calc(100vh-160px)] rounded-t-3xl border-t border-stone-700/40 shadow-2xl"
        style={{
          background: 'var(--cv-surface-sheet)',
          bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
        }}
        aria-label={showCategories ? 'Categories menu' : 'Tools menu'}
      >
        <div className="flex justify-center pt-2 pb-1.5">
          <span aria-hidden className="h-1 w-12 rounded-full bg-stone-600/60" />
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 pt-2 pb-8">
          {showCategories ? (
            <CategoryPanel
              categories={categoryTiles}
              query={categoryQ}
              setQuery={setCategoryQ}
              isActive={isActive}
              onBack={() => setShowCategories(false)}
              onNavigate={go}
            />
          ) : (
            <ToolsPanel
              searchQ={searchQ}
              setSearchQ={setSearchQ}
              onSearch={(q) => {
                router.push(`/search?q=${encodeURIComponent(q)}`)
                setSearchQ('')
                onClose()
              }}
              sensors={sensors}
              orderedTiles={orderedTiles}
              isActive={isActive}
              onDragEnd={onDragEnd}
              onNavigate={(tile) => {
                if (tile.key === 'categories') setShowCategories(true)
                else go(tile.href)
              }}
            />
          )}
        </div>
      </aside>
    </>
  )
}

function ToolsPanel({
  searchQ,
  setSearchQ,
  onSearch,
  sensors,
  orderedTiles,
  isActive,
  onDragEnd,
  onNavigate,
}: {
  searchQ: string
  setSearchQ: (value: string) => void
  onSearch: (query: string) => void
  sensors: ReturnType<typeof useSensors>
  orderedTiles: Tile[]
  isActive: (href: string) => boolean
  onDragEnd: (event: DragEndEvent) => void
  onNavigate: (tile: Tile) => void
}) {
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const q = searchQ.trim()
          if (q) onSearch(q)
        }}
        className="flex items-center gap-2 px-3 mb-5 rounded-full bg-stone-900/60 border border-stone-700/40 focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/20 transition"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/search.png"
          width={22}
          height={22}
          alt=""
          className="object-contain shrink-0 brightness-125 saturate-110 opacity-95"
        />
        <input
          type="search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search the vault..."
          className="flex-1 min-w-0 bg-transparent py-2.5 text-base text-stone-100 placeholder:text-stone-500 focus:outline-none"
        />
      </form>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={orderedTiles.map((t) => t.key)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {orderedTiles.map((tile) => (
              <SortableTile
                key={tile.key}
                tile={tile}
                active={isActive(tile.href)}
                onNavigate={() => onNavigate(tile)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )
}

function CategoryPanel({
  categories,
  query,
  setQuery,
  isActive,
  onBack,
  onNavigate,
}: {
  categories: DbCategory[]
  query: string
  setQuery: (value: string) => void
  isActive: (href: string) => boolean
  onBack: () => void
  onNavigate: (href: string) => void
}) {
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-700/50 bg-stone-900/50 text-stone-300 hover:border-accent-500/50 hover:text-stone-100 transition"
          aria-label="Back to tools"
          title="Back to tools"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-100">Categories</p>
          <p className="text-xs text-stone-500">Pick a category to open it.</p>
        </div>
      </div>

      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex items-center gap-2 px-3 mb-4 rounded-full bg-stone-900/60 border border-stone-700/40 focus-within:border-accent-500/60 focus-within:ring-2 focus-within:ring-accent-500/20 transition"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/system/search.png"
          width={22}
          height={22}
          alt=""
          className="object-contain shrink-0 brightness-125 saturate-110 opacity-95"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search categories..."
          className="flex-1 min-w-0 bg-transparent py-2.5 text-base text-stone-100 placeholder:text-stone-500 focus:outline-none"
        />
      </form>

      <div className="grid grid-cols-4 gap-1.5">
        {categories.map((cat) => (
          <CategoryTile
            key={cat.slug}
            category={cat}
            active={isActive(`/categories/${cat.slug}`)}
            onNavigate={() => onNavigate(`/categories/${cat.slug}`)}
          />
        ))}
      </div>
      {categories.length === 0 && (
        <p className="py-8 text-center text-sm text-stone-500">No categories match that search.</p>
      )}
    </>
  )
}

function SortableTile({
  tile,
  active,
  onNavigate,
}: {
  tile: Tile
  active: boolean
  onNavigate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.key })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 20 : undefined,
    boxShadow: isDragging ? '0 8px 24px rgb(0 0 0 / 0.45)' : undefined,
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={(e) => {
        if (isDragging) {
          e.preventDefault()
          return
        }
        onNavigate()
      }}
      aria-label={tile.label}
      aria-current={active ? 'page' : undefined}
      style={style}
      {...attributes}
      {...listeners}
      className={tileButtonClass(active, 'touch-none')}
    >
      <TileIcon src={tile.icon} badge={tile.badge} />
      <TileLabel>{tile.label}</TileLabel>
    </button>
  )
}

function CategoryTile({
  category,
  active,
  onNavigate,
}: {
  category: DbCategory
  active: boolean
  onNavigate: () => void
}) {
  const label = getCategoryLabel(category.slug, category.name)
  return (
    <button
      type="button"
      onClick={onNavigate}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={tileButtonClass(active)}
    >
      <TileIcon src={getCategoryIcon(category.slug, category.icon)} />
      <TileLabel>{label}</TileLabel>
    </button>
  )
}

function tileButtonClass(active: boolean, extra?: string) {
  return clsx(
    'group flex flex-col items-center text-center gap-1 px-0.5 pt-2 pb-1.5 rounded-xl border transition-colors',
    'border-stone-500/[0.18] bg-white/[0.03]',
    'hover:border-accent-500/45 hover:bg-white/[0.05]',
    active && 'border-accent-500/50 bg-white/[0.05]',
    extra,
  )
}

function TileIcon({ src, badge }: { src: string; badge?: string }) {
  return (
    <span className="relative flex h-9 w-9 items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        width={34}
        height={34}
        alt=""
        className="block h-[34px] w-[34px] object-contain pointer-events-none"
        style={{ filter: 'brightness(1.08) saturate(1.05)' }}
        draggable={false}
      />
      {badge && (
        <span className="absolute -top-1 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[9px] font-bold text-stone-950">
          {badge}
        </span>
      )}
    </span>
  )
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9.5px] font-semibold leading-[1.1] text-stone-300 group-hover:text-stone-100 line-clamp-2 pointer-events-none">
      {children}
    </span>
  )
}
