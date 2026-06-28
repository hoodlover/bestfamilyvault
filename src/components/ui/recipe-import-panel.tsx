'use client'

// "Import from web" panel for the new-recipe form. Two tabs:
//   • Search — types a query, server uses Claude web search to return up
//     to 5 candidate URLs. Click one → calls /api/recipe-import to fetch
//     the page, parse schema.org JSON-LD, then hand the structured
//     recipe back to the parent form.
//   • Paste URL — direct URL input that skips the search step. Same
//     /api/recipe-import call.
//
// The parent form decides what to do with the returned recipe (typically:
// pre-fill empty fields). This component is just the UI + transport.

import { useState } from 'react'
import { Globe, Link as LinkIcon, Search, Star } from 'lucide-react'

export interface ImportedRecipe {
  title: string | null
  ingredients: string[]
  method: string | null
  story: string | null
  servings: number | null
  sourceUrl: string
}

interface SearchResult {
  title: string
  url: string
  source: string
  brief: string
  /** Loaded lazily after the search returns. null = checked + missing. */
  rating?: number | null
  ratingCount?: number | null
  /** True once /api/recipe-rating has answered (success or fail). */
  ratingLoaded?: boolean
}

/** Minimum rating to keep a result visible when the filter is on. */
const RATING_FILTER_THRESHOLD = 4.5

interface Props {
  onImported: (recipe: ImportedRecipe) => void
}

type Tab = 'search' | 'url'

export function RecipeImportPanel({ onImported }: Props) {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Filter on by default — user asked for top-rated only. They can flip
  // it off to see everything (including recipes whose host doesn't
  // publish ratings).
  const [topOnly, setTopOnly] = useState(true)

  async function runSearch() {
    if (query.trim().length < 2) return
    setSearching(true)
    setMessage(null)
    setResults([])
    try {
      const res = await fetch('/api/recipe-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error ?? 'Search failed.')
        return
      }
      const list = (data.results ?? []) as SearchResult[]
      setResults(list)
      if (list.length === 0) {
        setMessage('No matching recipes found. Try different words.')
      } else {
        // Fire rating fetches in parallel; each result updates as it
        // lands so the user sees stars stream in. Errors flip
        // ratingLoaded=true with null values so the filter knows
        // "checked + missing" vs "still pending".
        for (const r of list) {
          void (async () => {
            try {
              const rr = await fetch('/api/recipe-rating', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: r.url }),
              })
              const d = await rr.json().catch(() => ({}))
              setResults((prev) => prev.map((p) =>
                p.url === r.url
                  ? { ...p, rating: typeof d.rating === 'number' ? d.rating : null, ratingCount: typeof d.ratingCount === 'number' ? d.ratingCount : null, ratingLoaded: true }
                  : p,
              ))
            } catch {
              setResults((prev) => prev.map((p) =>
                p.url === r.url ? { ...p, rating: null, ratingCount: null, ratingLoaded: true } : p,
              ))
            }
          })()
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function importUrl(target: string) {
    setImporting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/recipe-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.recipe) {
        setMessage(data.error ?? 'Import failed.')
        return
      }
      onImported(data.recipe as ImportedRecipe)
      setMessage('Recipe imported. Eyeball the fields and tweak anything off.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-emerald-300 shrink-0" />
        <p className="text-sm font-medium text-stone-200">Import from the web</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-stone-700 p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setTab('search')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
            tab === 'search'
              ? 'bg-emerald-700/30 text-emerald-200'
              : 'text-stone-400 hover:text-stone-200'
          }`}
        >
          <Search size={12} />
          Search
        </button>
        <button
          type="button"
          onClick={() => setTab('url')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
            tab === 'url'
              ? 'bg-emerald-700/30 text-emerald-200'
              : 'text-stone-400 hover:text-stone-200'
          }`}
        >
          <LinkIcon size={12} />
          Paste URL
        </button>
      </div>

      {tab === 'search' && (
        <div className="space-y-2">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch() }}
            className="flex items-center gap-2"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="chocolate chip cookies, weeknight pasta…"
              disabled={searching || importing}
              className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            />
            <button
              type="submit"
              disabled={searching || importing || query.trim().length < 2}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {searching ? (
                <>
                  <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Search size={13} />
                  Search
                </>
              )}
            </button>
          </form>
          {results.length > 0 && (() => {
            // Top-only filter: keep rows whose rating cleared the threshold,
            // PLUS rows where the rating is still loading (so the list
            // doesn't flash empty before ratings resolve). Hide rows that
            // came back checked-but-below-threshold.
            const visible = topOnly
              ? results.filter((r) => !r.ratingLoaded || (r.rating != null && r.rating >= RATING_FILTER_THRESHOLD))
              : results
            const hiddenCount = results.length - visible.length
            const loadingCount = results.filter((r) => !r.ratingLoaded).length
            return (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={topOnly}
                      onChange={(e) => setTopOnly(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
                    />
                    Only {RATING_FILTER_THRESHOLD}+ stars
                  </label>
                  <span>
                    {loadingCount > 0 && <>checking ratings… </>}
                    {topOnly && hiddenCount > 0 && <>{hiddenCount} hidden (low rating)</>}
                  </span>
                </div>
                {visible.length === 0 && loadingCount === 0 ? (
                  <p className="text-[11px] text-stone-500 italic px-1 py-2">
                    No results at {RATING_FILTER_THRESHOLD}+ stars. Try unticking the filter above.
                  </p>
                ) : (
                  <ul className="rounded-lg border border-stone-800 divide-y divide-stone-800 overflow-hidden">
                    {visible.map((r) => (
                      <li key={r.url}>
                        <button
                          type="button"
                          onClick={() => importUrl(r.url)}
                          disabled={importing}
                          className="w-full text-left px-3 py-2 hover:bg-stone-800 disabled:opacity-60 transition"
                        >
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-stone-100 flex-1 min-w-0">{r.title}</div>
                            {r.ratingLoaded && r.rating != null && (
                              <span className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-amber-300">
                                <Star size={11} className="fill-amber-300" />
                                {r.rating.toFixed(1)}
                                {r.ratingCount != null && r.ratingCount > 0 && (
                                  <span className="text-stone-500 ml-0.5">({formatCount(r.ratingCount)})</span>
                                )}
                              </span>
                            )}
                            {!r.ratingLoaded && (
                              <span className="shrink-0 inline-flex items-center text-[10px] text-stone-600">…</span>
                            )}
                          </div>
                          <div className="text-[11px] text-stone-500 mt-0.5">
                            <span className="text-emerald-400">{r.source}</span>
                            {r.brief && <> — {r.brief}</>}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )
          })()}
          <p className="text-[11px] text-stone-500">
            Search uses Claude with the web as a source. Results are cherry-picked from major recipe sites.
          </p>
        </div>
      )}

      {tab === 'url' && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) importUrl(url.trim()) }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.allrecipes.com/recipe/…"
              disabled={importing}
              className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            />
            <button
              type="submit"
              disabled={importing || url.trim() === ''}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {importing ? (
                <>
                  <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <LinkIcon size={13} />
                  Import
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-stone-500">
            Works with major recipe sites (AllRecipes, NYT Cooking, Food Network, Bon Appétit, …)
          </p>
        </form>
      )}

      {message && <p className="text-xs text-stone-300 leading-relaxed">{message}</p>}
    </div>
  )
}

// "1,234" / "12k" depending on size. Recipe sites with hundreds of
// thousands of ratings make for a long string otherwise.
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
}
