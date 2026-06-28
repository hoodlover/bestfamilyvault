'use client'

// Shared "browse a category" popup — a grid of every category tile that
// the desktop sidebar and the mobile home both launch from. Mirrors the
// AddMenuOverlay pattern (blurred backdrop, centered card, Escape /
// click-outside / tile-tap dismisses) so both popups feel native to
// the same family.
//
// Why factor this out: the desktop sidebar Categories drawer used to
// expand inline (cramming the whole list into the side rail), and the
// mobile home page held its own duplicate category grid below. Both
// surfaces now reach for one shared overlay — adding/removing a
// category is a one-place edit on the parent's category query.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { getCategoryIcon, getCategoryLabel } from '@/lib/category-presentation'
import { isGuideSlug } from '@/lib/dead-now-what-config'

interface DbCategory {
  id: string
  name: string
  slug: string
  icon: string | null
}

interface OverlayProps {
  categories: DbCategory[]
  onClose: () => void
}

export function CategoriesOverlay({ categories, onClose }: OverlayProps) {
  // Escape closes — matches the AddMenuOverlay affordance + the mobile
  // bottom-sheet pattern so muscle memory carries across.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The IDNW guide auto-seeds itself as a category but lives behind its
  // own dedicated nav pill — filter it out so it doesn't double up here.
  // Receipts gets its own summary route (/receipts) rather than the
  // generic /categories/<slug> page.
  const visible = categories.filter((cat) => !isGuideSlug(cat.slug))

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 md:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-gradient-to-br from-stone-900/95 to-black/95 shadow-2xl shadow-black/60 backdrop-blur-md p-4"
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[11px] uppercase tracking-[0.25em] text-stone-500">
            Pick a category
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
        <div className="grid grid-cols-3 gap-2">
          {visible.map((cat) => (
            <Link
              key={cat.slug}
              href={cat.slug === 'receipts' ? '/receipts' : `/categories/${cat.slug}`}
              onClick={onClose}
              className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-1 py-1.5 transition active:scale-95"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getCategoryIcon(cat.slug, cat.icon)}
                width={44}
                height={44}
                alt=""
                className="block h-[44px] w-[44px] object-contain"
              />
              <span className="text-[10px] font-medium text-stone-200 leading-tight text-center">
                {getCategoryLabel(cat.slug, cat.name)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// Self-contained tile launcher — for surfaces (like the RSC dashboard)
// where the consumer can't easily own the open/close state itself. Uses
// the same chrome as the dashboard's existing ActionTile so it slots
// into the "Find & browse" row without restyling.
interface TileProps {
  categories: DbCategory[]
  img: string
  title: string
  detail: string
  accent?: 'amber' | 'violet' | 'sky' | 'emerald'
}

export function CategoriesTile({ categories, img, title, detail, accent = 'emerald' }: TileProps) {
  const [open, setOpen] = useState(false)
  const accentClass = {
    emerald: 'border-emerald-700/40 hover:border-emerald-500/70',
    amber: 'border-amber-700/40 hover:border-amber-500/70',
    sky: 'border-sky-700/40 hover:border-sky-500/70',
    violet: 'border-violet-700/40 hover:border-violet-500/70',
  }[accent]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Class soup mirrors the dashboard's ActionTile exactly (mobile
        // stacks icon-over-title, desktop side-by-side with detail
        // subtitle) so this button visually slots into the "Find &
        // browse" row as if it were just another ActionTile.
        className={`vault-card vault-card-hover group flex flex-col items-center text-center md:flex-row md:items-center md:text-left md:gap-3 gap-1.5 rounded-xl p-2.5 md:p-3 ${accentClass} w-full`}
      >
        <span className="flex h-12 w-12 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-lg bg-stone-950/55 ring-1 ring-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} width={40} height={40} alt="" className="object-contain rounded md:w-[46px] md:h-[46px]" />
        </span>
        <span className="min-w-0 w-full">
          <span className="flex items-center justify-center md:justify-start text-[12px] md:text-sm font-semibold text-stone-100 leading-tight md:leading-normal">
            <span className="break-words">{title}</span>
          </span>
          <span className="hidden md:block mt-0.5 text-xs leading-snug text-stone-500 group-hover:text-stone-400">{detail}</span>
        </span>
      </button>
      {open && <CategoriesOverlay categories={categories} onClose={() => setOpen(false)} />}
    </>
  )
}
