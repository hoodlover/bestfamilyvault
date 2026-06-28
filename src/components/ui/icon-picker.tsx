'use client'

// Modal grid of every icon in public/icons/cobb/, with type-to-filter.
// Used from the category editor in two places (category icon, subcategory
// icon). The list is passed in as a prop — populated server-side via
// getCobbIcons() so the modal opens instantly with no client fetch.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Image as ImageIcon, Search, X } from 'lucide-react'

export interface PickerIcon {
  path: string
  name: string
  search: string
  /** Group label assigned by the server. Optional for backwards compat;
   *  picker falls back to "All icons" for icons missing a section. */
  section?: string
}

interface Props {
  /** Currently-set icon path (URL or local /icons/cobb/...) — used to highlight. */
  value: string | null
  /** Full library list, supplied server-side. */
  icons: PickerIcon[]
  /** Persists the choice. The string is the new icon path, or '' to clear.
   *  Caller may return any object — we only inspect `error` if present. */
  onPick: (iconPath: string) => Promise<unknown> | void
  /** Optional label for the trigger button. When omitted the trigger is icon-only. */
  label?: string
}

export function IconPicker({ value, icons, onPick, label }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const close = useCallback(() => {
    if (busy) return
    setOpen(false)
    setError(null)
    setQuery('')
  }, [busy])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, close])

  // Filter by query (case-insensitive, ignores non-alphanum so "add file"
  // matches "add_file"), then group by section preserving server order.
  const grouped = useMemo(() => {
    const needle = query.toLowerCase().replace(/[^a-z0-9]/g, '')
    const filtered = needle
      ? icons.filter((i) => i.search.includes(needle) || i.name.toLowerCase().includes(query.toLowerCase()))
      : icons
    const order: string[] = []
    const map = new Map<string, PickerIcon[]>()
    for (const icon of filtered) {
      const key = icon.section ?? 'All icons'
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(icon)
    }
    return order.map((name) => ({ name, items: map.get(name)! }))
  }, [icons, query])

  const filteredCount = grouped.reduce((acc, g) => acc + g.items.length, 0)

  async function pick(iconPath: string) {
    setBusy(true)
    setError(null)
    try {
      const res = (await onPick(iconPath)) as { error?: string } | void | null
      if (res && typeof res === 'object' && 'error' in res && typeof res.error === 'string') {
        setError(res.error)
        setBusy(false)
        return
      }
      setBusy(false)
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set icon.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Pick from icon library"
        aria-label="Pick from icon library"
        className="flex shrink-0 items-center gap-1 rounded-md border border-stone-700 px-1.5 py-1 text-xs text-stone-500 transition hover:border-emerald-700/60 hover:text-emerald-400"
      >
        <ImageIcon size={12} />
        {label && <span>{label}</span>}
      </button>

      {open && (
        <div
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-stone-800">
              <h2 className="text-sm font-semibold text-stone-100">Choose an icon</h2>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition disabled:opacity-50"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search — intentionally NOT autofocused so the mobile keyboard
                doesn't pop up automatically. Tap the input to start typing. */}
            <div className="px-5 py-2 border-b border-stone-800">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-600 pointer-events-none" />
                <input
                  type="search"
                  inputMode="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter icons by name…"
                  className="w-full bg-stone-950/60 border border-stone-800 rounded-md pl-7 pr-2 py-1.5 text-xs text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-emerald-700/60"
                />
              </div>
            </div>
            <div className="px-5 py-2 border-b border-stone-800 flex items-center justify-between text-[11px] text-stone-500">
              <span>
                {query
                  ? `${filteredCount} of ${icons.length} icon${icons.length === 1 ? '' : 's'}`
                  : `${icons.length} icon${icons.length === 1 ? '' : 's'}`}
              </span>
              {value && (
                <button
                  type="button"
                  onClick={() => pick('')}
                  disabled={busy}
                  className="text-amber-400 hover:text-amber-300 transition disabled:opacity-50"
                >
                  Clear current
                </button>
              )}
            </div>
            {error && <p className="px-5 pt-2 text-xs text-red-400">{error}</p>}

            <div className="flex-1 overflow-y-auto p-3 space-y-5">
              {grouped.map((group) => (
                  <section key={group.name}>
                    {/* Headers used to be sticky (top-0), but the first
                        section's header was getting stuck in place on
                        mobile while the rest of the list scrolled under
                        it. Plain headers scroll with their section. */}
                    <h3 className="-mx-3 px-3 py-1 mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-500">
                      {group.name} <span className="text-stone-600 font-normal">({group.items.length})</span>
                    </h3>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                      {group.items.map((icon) => {
                        const selected = value === icon.path
                        return (
                          <button
                            key={icon.path}
                            type="button"
                            onClick={() => pick(icon.path)}
                            disabled={busy}
                            title={icon.name}
                            className={`group flex flex-col items-center gap-1 p-2 rounded-lg border transition disabled:opacity-50 ${
                              selected
                                ? 'border-emerald-500/70 bg-emerald-700/15 ring-1 ring-emerald-500/40'
                                : 'border-stone-800 hover:border-stone-600 hover:bg-stone-800'
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={icon.path}
                              alt=""
                              width={48}
                              height={48}
                              loading="lazy"
                              decoding="async"
                              className="block h-12 w-12 object-contain"
                            />
                            <span className="text-[10px] text-stone-500 group-hover:text-stone-300 truncate w-full text-center leading-tight">
                              {icon.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
