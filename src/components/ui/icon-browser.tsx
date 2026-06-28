'use client'

// Browse every icon under /public/icons. Filter by name or folder,
// click any thumbnail to copy its /icons/... path to the clipboard.
// Lives at /admin/icons so the maintainer can find a specific icon
// when they forget what file it was.

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { VaultIcon } from '@/lib/all-icons'

interface Props {
  icons: VaultIcon[]
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function IconBrowser({ icons }: Props) {
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    if (!ql) return icons
    return icons.filter((i) =>
      i.name.toLowerCase().includes(ql) ||
      i.folder.toLowerCase().includes(ql) ||
      i.path.toLowerCase().includes(ql)
    )
  }, [icons, q])

  const byFolder = useMemo(() => {
    const m = new Map<string, VaultIcon[]>()
    for (const i of filtered) {
      const arr = m.get(i.folder) ?? []
      arr.push(i)
      m.set(i.folder, arr)
    }
    return Array.from(m.entries())
  }, [filtered])

  async function copy(p: string) {
    try {
      await navigator.clipboard.writeText(p)
      setCopied(p)
      setTimeout(() => setCopied((cur) => (cur === p ? null : cur)), 1500)
    } catch {
      // Clipboard may be unavailable on some browsers — show the path
      // anyway so the user can long-press / select-copy manually.
      setCopied(p)
    }
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 md:-mx-0 px-4 md:px-0 py-2 bg-stone-950/95 backdrop-blur border-b border-stone-800 md:border-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name, folder, or path…"
            className="w-full pl-9 pr-9 py-2.5 bg-stone-900 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              aria-label="Clear filter"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-stone-200"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-stone-500">
          {q
            ? `${filtered.length} of ${icons.length} icons match "${q}"`
            : `${icons.length} icons across ${byFolder.length} folders`}
          {' — '}tap any icon to copy its path.
        </p>
      </div>

      {byFolder.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">No matches.</p>
      ) : (
        byFolder.map(([folder, list]) => (
          <section key={folder || '(root)'}>
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              {folder || '(top level)'}
              <span className="ml-1.5 text-stone-600 font-normal normal-case">({list.length})</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {list.map((i) => {
                const isCopied = copied === i.path
                return (
                  <button
                    key={i.path}
                    type="button"
                    onClick={() => copy(i.path)}
                    title={`${i.path} (${humanBytes(i.size)})`}
                    className={`group flex flex-col items-center gap-1 p-2 rounded-lg border transition ${
                      isCopied
                        ? 'border-emerald-500 bg-emerald-950/40'
                        : 'border-stone-800 bg-stone-900/40 hover:border-stone-600 hover:bg-stone-800/60'
                    }`}
                  >
                    <div className="relative w-full aspect-square bg-black/40 rounded overflow-hidden flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={i.path}
                        alt={i.name}
                        loading="lazy"
                        className="max-w-full max-h-full object-contain"
                      />
                      {isCopied && (
                        <span className="absolute inset-0 flex items-center justify-center bg-emerald-600/85 text-white text-xs font-semibold">
                          <Check size={14} className="mr-1" />
                          Copied
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-stone-300 leading-tight break-all line-clamp-2 w-full text-center">
                      {i.name}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
