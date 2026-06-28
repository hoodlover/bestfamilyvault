'use client'

// Client child of RecentlyImportedSection. Tracks a single
// "lastSeenAt" timestamp in localStorage and renders a NEW pill on
// every file whose createdAt is newer. "Mark all seen" bumps the
// timestamp to now — global to the device, not per-file, so one click
// clears every badge in the section.
//
// Why localStorage instead of a DB column: the surface is informational
// and per-device. Adding a per-file viewed_at column would mean either
// per-user join state (overkill) or a single "seen by owner" flag
// (which would silently dismiss the badge for Heather too if Lance
// clicked it on her phone). localStorage stays scoped to whoever is
// looking at it.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Sparkles, FileText, Image as ImageIcon, FileIcon } from 'lucide-react'

interface RecentItem {
  id: string
  filename: string
  contentType: string
  size: number
  createdAtIso: string
  parentHref: string | null
  parentTitle: string
}

const LS_KEY = 'bestfamilyvault.import.lastSeenAt'

export function RecentlyImportedCards({ items, days }: { items: RecentItem[]; days: number }) {
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LS_KEY) : null
    if (stored) {
      const d = new Date(stored)
      if (!Number.isNaN(d.getTime())) setLastSeenAt(d)
    }
    setHydrated(true)
  }, [])

  function markAllSeen() {
    const now = new Date()
    window.localStorage.setItem(LS_KEY, now.toISOString())
    setLastSeenAt(now)
  }

  // Don't compute NEW until after hydration — render with no NEW pills
  // on the server to avoid a hydration mismatch flash. Hydration-aware
  // boolean keeps SSR markup identical to first client render.
  const newCount = hydrated
    ? items.filter((i) => !lastSeenAt || new Date(i.createdAtIso) > lastSeenAt).length
    : 0

  return (
    <section className="mb-8 rounded-xl border border-stone-800 bg-stone-900/45 p-4">
      <header className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-emerald-400 shrink-0" />
          <h2 className="text-sm font-semibold text-stone-100 truncate">
            Recently imported
          </h2>
          <span className="text-xs text-stone-500">last {days} days</span>
          {hydrated && newCount > 0 && (
            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-green-500/25 border border-green-400 text-green-200">
              {newCount} new
            </span>
          )}
        </div>
        {hydrated && newCount > 0 && (
          <button
            type="button"
            onClick={markAllSeen}
            className="shrink-0 text-xs font-medium text-stone-400 hover:text-stone-200 transition"
          >
            Mark all seen
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((i) => {
          const isNew = hydrated && (!lastSeenAt || new Date(i.createdAtIso) > lastSeenAt)
          const date = new Date(i.createdAtIso)
          const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          const card = (
            <div
              className={
                'relative flex items-start gap-3 p-3 rounded-xl border transition ' +
                (isNew
                  ? 'border-green-400/60 bg-green-500/10 hover:bg-green-500/20'
                  : 'border-stone-700/50 bg-stone-800/40 hover:bg-stone-800')
              }
            >
              {isNew && (
                <span className="absolute top-2 right-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-green-500 text-green-950 shadow-md">
                  NEW
                </span>
              )}
              <FileTypeIcon contentType={i.contentType} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-100 truncate pr-12" title={i.filename}>
                  {i.filename}
                </p>
                <p className="text-xs text-stone-400 truncate" title={i.parentTitle}>
                  → {i.parentTitle}
                </p>
                <p className="mt-1 text-[11px] text-stone-500">
                  {dateLabel} · {formatBytes(i.size)}
                </p>
              </div>
            </div>
          )
          return i.parentHref ? (
            <Link key={i.id} href={i.parentHref} className="block">
              {card}
            </Link>
          ) : (
            <div key={i.id}>{card}</div>
          )
        })}
      </div>
    </section>
  )
}

function FileTypeIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/'))
    return <ImageIcon size={18} className="text-blue-400 shrink-0 mt-0.5" />
  if (contentType === 'application/pdf')
    return <FileText size={18} className="text-red-400 shrink-0 mt-0.5" />
  return <FileIcon size={18} className="text-stone-400 shrink-0 mt-0.5" />
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
