'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Eye, EyeOff, Trash2, AlertTriangle, Copy as CopyIcon, GitMerge, Pencil, Save, X as XIcon, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { bulkDeleteLogins, updateLoginFields } from '@/lib/actions/password-cleanup'
import { PasswordMergePanel } from './password-merge-panel'

interface LoginRow {
  id: string
  title: string
  username: string | null
  password: string | null
  url: string | null
  category: string
  categoryId?: string
  updatedAt: string | null
}

interface Props {
  logins: LoginRow[]
}

type SortKey = 'title' | 'domain' | 'updatedAt'
type FilterKey = 'duplicates' | 'stale' | 'noUrl' | 'noPassword'

const STALE_THRESHOLD_MS = 2 * 365 * 86_400_000

function normalizeDomain(url: string | null): string {
  if (!url) return ''
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function PasswordCleanupList({ logins }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('title')
  // Default to "all revealed" — this page is admin-only behind login and
  // is a focused one-shot cleanup workflow, so the convenience of seeing
  // every password at a glance beats the shoulder-surfing risk. Lance
  // can still hit the master toggle to hide them all if he's about to
  // screen-share or someone walks in.
  const [revealAll, setRevealAll] = useState(true)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set())
  const [confirming, setConfirming] = useState(false)
  // Off by default — Lance was drowning in Excel files. Click the box
  // in the confirm bar when you genuinely want a snapshot (e.g., bulk
  // delete of 50+ logins before a big password rotation).
  const [wantsCsv, setWantsCsv] = useState(false)
  const [merging, setMerging] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Precompute normalized domain + duplicate flag once per render so
  // sort/filter/render stays cheap even at 500+ rows.
  const enriched = useMemo(() => {
    const withDomain = logins.map((l) => ({
      ...l,
      domain: normalizeDomain(l.url),
    }))
    // Group by (domain, username) → flag any row in a multi-row group
    // as a likely duplicate.
    const dupKey = (r: { domain: string; username: string | null }) =>
      `${r.domain}|${(r.username ?? '').toLowerCase().trim()}`
    const groupCount = new Map<string, number>()
    for (const r of withDomain) {
      if (!r.domain && !r.username) continue
      groupCount.set(dupKey(r), (groupCount.get(dupKey(r)) ?? 0) + 1)
    }
    return withDomain.map((r) => ({
      ...r,
      isDuplicate: (groupCount.get(dupKey(r)) ?? 0) > 1,
    }))
  }, [logins])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const now = Date.now()
    return enriched.filter((r) => {
      if (q) {
        const hay = `${r.title} ${r.username ?? ''} ${r.url ?? ''} ${r.category}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.has('duplicates') && !r.isDuplicate) return false
      if (filters.has('stale')) {
        const updatedMs = r.updatedAt ? Date.parse(r.updatedAt) : 0
        if (!updatedMs || now - updatedMs < STALE_THRESHOLD_MS) return false
      }
      if (filters.has('noUrl') && r.url) return false
      if (filters.has('noPassword') && r.password) return false
      return true
    })
  }, [enriched, search, filters])

  const sorted = useMemo(() => {
    const list = [...filtered]
    list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'domain') {
        const cmp = a.domain.localeCompare(b.domain)
        return cmp !== 0 ? cmp : a.title.localeCompare(b.title)
      }
      // updatedAt — oldest first (those are the cleanup candidates)
      const aMs = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const bMs = b.updatedAt ? Date.parse(b.updatedAt) : 0
      return aMs - bMs
    })
    return list
  }, [filtered, sort])

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      // If every visible row is already selected, clear. Otherwise add all.
      const allSelected = sorted.every((r) => prev.has(r.id))
      const next = new Set(prev)
      if (allSelected) for (const r of sorted) next.delete(r.id)
      else for (const r of sorted) next.add(r.id)
      return next
    })
  }

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function isRevealed(id: string): boolean {
    return revealAll || revealedIds.has(id)
  }

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // ignore — old browsers / non-secure contexts. The reveal pane
      // still shows the value so the user can hand-copy.
    }
  }

  function handleDelete() {
    setError(null)
    const ids = [...selected]
    startTransition(async () => {
      const res = await bulkDeleteLogins(ids, { includeCsv: wantsCsv })
      if (res.error) {
        setError(res.error)
        setConfirming(false)
        return
      }
      // Offer the CSV as a download before the page refreshes.
      if (res.csv && res.filename) {
        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        // Defer revoke a beat so Safari has time to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
      setSelected(new Set())
      setConfirming(false)
      router.refresh()
    })
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id))

  return (
    <div className="space-y-4">
      {/* Controls bar — sticky at the top while scrolling the long list */}
      <div className="sticky top-0 z-10 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-stone-950/95 backdrop-blur border-b border-stone-800 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-900/60 border border-stone-700/60 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
            <Search size={16} className="text-stone-500 shrink-0" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, username, URL, category..."
              className="flex-1 min-w-0 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-none"
            />
            <span className="text-[11px] text-stone-500 shrink-0">{sorted.length} of {logins.length}</span>
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-3 py-2 rounded-lg bg-stone-900/60 border border-stone-700/60 text-sm text-stone-100 focus:outline-none"
            title="Sort"
          >
            <option value="title">Sort: Title</option>
            <option value="domain">Sort: Domain (groups dupes)</option>
            <option value="updatedAt">Sort: Oldest first</option>
          </select>

          <button
            type="button"
            onClick={() => setRevealAll((v) => !v)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition',
              revealAll
                ? 'border-amber-700/50 bg-amber-950/30 text-amber-200'
                : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:bg-stone-800',
            )}
            title="Toggle password reveal for every row"
          >
            {revealAll ? <Eye size={14} /> : <EyeOff size={14} />}
            {revealAll ? 'Hide all' : 'Reveal all'}
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filters.has('duplicates')} onClick={() => toggleFilter('duplicates')}>
            Duplicates only
          </FilterChip>
          <FilterChip active={filters.has('stale')} onClick={() => toggleFilter('stale')}>
            Stale (&gt;2y)
          </FilterChip>
          <FilterChip active={filters.has('noUrl')} onClick={() => toggleFilter('noUrl')}>
            No URL
          </FilterChip>
          <FilterChip active={filters.has('noPassword')} onClick={() => toggleFilter('noPassword')}>
            No password
          </FilterChip>
          <span className="flex-1" />
          <label className="inline-flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAllVisible}
              className="accent-emerald-600"
            />
            Select all visible
          </label>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-red-950/30 border border-red-800/50">
            <span className="text-sm text-red-200">
              <strong>{selected.size}</strong> selected
            </span>
            <span className="flex-1" />
            {confirming ? (
              <>
                <label className="inline-flex items-center gap-1.5 text-xs text-red-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={wantsCsv}
                    onChange={(e) => setWantsCsv(e.target.checked)}
                    className="accent-red-500"
                  />
                  Save CSV backup
                </label>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="px-3 py-1.5 text-sm font-medium text-stone-300 hover:text-stone-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg transition"
                >
                  <Trash2 size={14} />
                  {pending ? 'Deleting…' : 'Confirm delete'}
                </button>
              </>
            ) : (
              <>
                {selected.size >= 2 && (
                  <button
                    type="button"
                    onClick={() => setMerging(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
                    title="Merge the selected entries into one — pick which value wins per field"
                  >
                    <GitMerge size={14} />
                    Merge ({selected.size})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg transition"
                >
                  <Trash2 size={14} />
                  Delete selected ({selected.size})
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-700/50 text-sm text-amber-200 flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
      </div>

      {/* Merge panel — opens over the list, closes on save/cancel.
          Built from the currently-selected rows so the user doesn't lose
          their picks if they scroll while it's open. */}
      {merging && (
        <PasswordMergePanel
          rows={enriched
            .filter((r) => selected.has(r.id))
            .map((r) => ({
              id: r.id,
              title: r.title,
              username: r.username,
              password: r.password,
              url: r.url,
              categoryId: r.categoryId ?? '',
              category: r.category,
              updatedAt: r.updatedAt,
            }))}
          onClose={() => {
            setMerging(false)
            // Clear the selection — the merged row's still around but
            // the deletes are gone; selecting them would 404 next action.
            setSelected(new Set())
          }}
        />
      )}

      {/* Row list */}
      {sorted.length === 0 ? (
        <p className="text-sm text-stone-500 text-center py-12">No logins match the current filter.</p>
      ) : (
        <div className="space-y-1">
          {sorted.map((r) => (
            <Row
              key={r.id}
              row={r}
              selected={selected.has(r.id)}
              revealed={isRevealed(r.id)}
              editing={editingId === r.id}
              onToggleSelect={() => toggleSelected(r.id)}
              onToggleReveal={() => toggleReveal(r.id)}
              onCopyPassword={() => r.password && copyToClipboard(r.password)}
              onStartEdit={() => setEditingId(r.id)}
              onCancelEdit={() => setEditingId(null)}
              onSavedEdit={() => {
                setEditingId(null)
                router.refresh()
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 rounded-full text-xs font-medium border transition',
        active
          ? 'border-emerald-600/60 bg-emerald-950/40 text-emerald-200'
          : 'border-stone-700 bg-stone-900/40 text-stone-400 hover:bg-stone-800',
      )}
    >
      {children}
    </button>
  )
}

function Row({
  row,
  selected,
  revealed,
  editing,
  onToggleSelect,
  onToggleReveal,
  onCopyPassword,
  onStartEdit,
  onCancelEdit,
  onSavedEdit,
}: {
  row: LoginRow & { domain: string; isDuplicate: boolean }
  selected: boolean
  revealed: boolean
  editing: boolean
  onToggleSelect: () => void
  onToggleReveal: () => void
  onCopyPassword: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSavedEdit: () => void
}) {
  const updatedAgo = formatUpdatedAgo(row.updatedAt)

  // Edit mode renders an entirely different layout so the row stops
  // being a <label> (clicking inside the inputs shouldn't toggle the
  // checkbox), and the row gets focus styling that matches "this is
  // the one I'm working on."
  if (editing) {
    return (
      <div className="rounded-xl border border-emerald-600/60 bg-emerald-950/20 px-3 py-3">
        <RowEditForm row={row} onCancel={onCancelEdit} onSaved={onSavedEdit} />
      </div>
    )
  }

  return (
    <label
      className={clsx(
        'flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition',
        selected
          ? 'border-emerald-600/50 bg-emerald-950/20'
          : 'border-stone-800 bg-stone-900/40 hover:bg-stone-900/70',
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        className="mt-1 accent-emerald-600 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-stone-100 truncate">{row.title}</p>
          {row.isDuplicate && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-900/40 border border-amber-700/50 text-amber-200">
              dup
            </span>
          )}
          {row.category && (
            <span className="text-[10px] text-stone-500 truncate">· {row.category}</span>
          )}
        </div>
        <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-stone-400">
          <span className="text-stone-500">user</span>
          <span className="truncate font-mono">{row.username ?? <em className="text-stone-600 not-italic">—</em>}</span>
          <span className="text-stone-500">pass</span>
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate font-mono">
              {row.password ? (revealed ? row.password : '••••••••••') : <em className="text-stone-600 not-italic">—</em>}
            </span>
            {row.password && (
              <>
                <button
                  type="button"
                  // stopPropagation + preventDefault BOTH — preventDefault
                  // alone lets the click bubble to the wrapping <label>,
                  // which then toggles the row's selection checkbox.
                  // Lance hit this: tapping the eye felt like "nothing
                  // happened" because the row toggled selection instead.
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleReveal() }}
                  className="p-1.5 -m-1 text-stone-500 hover:text-stone-200 hover:bg-stone-800 rounded"
                  title={revealed ? 'Hide' : 'Reveal'}
                  aria-label={revealed ? 'Hide password' : 'Reveal password'}
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCopyPassword() }}
                  className="p-1.5 -m-1 text-stone-500 hover:text-stone-200 hover:bg-stone-800 rounded"
                  title="Copy password"
                  aria-label="Copy password"
                >
                  <CopyIcon size={14} />
                </button>
              </>
            )}
          </span>
          <span className="text-stone-500">url</span>
          <span className="truncate text-stone-400">
            {row.domain || (row.url ?? <em className="text-stone-600 not-italic">—</em>)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onStartEdit() }}
          className="p-1 text-stone-500 hover:text-emerald-300 hover:bg-stone-800 rounded transition"
          title="Edit this entry inline"
          aria-label="Edit entry"
        >
          <Pencil size={13} />
        </button>
        {updatedAgo && (
          <span className="text-[10px] text-stone-500 whitespace-nowrap pt-0.5">{updatedAgo}</span>
        )}
      </div>
    </label>
  )
}

function RowEditForm({
  row,
  onCancel,
  onSaved,
}: {
  row: LoginRow
  onCancel: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(row.title)
  const [username, setUsername] = useState(row.username ?? '')
  const [password, setPassword] = useState(row.password ?? '')
  const [url, setUrl] = useState(row.url ?? '')
  const [revealing, setRevealing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await updateLoginFields(row.id, {
        title,
        username,
        password,
        url,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      onSaved()
    })
  }

  return (
    <form onSubmit={handleSave} className="space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold mb-1">
        Editing — {row.category || 'login'}
      </p>
      <Field label="Title" value={title} onChange={setTitle} required />
      <Field label="Username" value={username} onChange={setUsername} mono />
      <PasswordField
        value={password}
        onChange={setPassword}
        revealing={revealing}
        onToggleReveal={() => setRevealing((v) => !v)}
      />
      <Field label="URL" value={url} onChange={setUrl} mono placeholder="https://..." />
      {error && (
        <div className="px-2 py-1.5 rounded bg-red-950/40 border border-red-800/50 text-xs text-red-200 flex items-center gap-1.5">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-300 hover:text-stone-100 transition disabled:opacity-60"
        >
          <XIcon size={12} />
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-lg transition"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  required,
  mono,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  mono?: boolean
  placeholder?: string
}) {
  return (
    <label className="grid grid-cols-[60px_1fr] items-center gap-2 text-xs text-stone-400">
      <span className="text-stone-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className={clsx(
          'w-full px-2 py-1.5 rounded-md bg-stone-900 border border-stone-700 text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-500/60',
          mono && 'font-mono',
        )}
      />
    </label>
  )
}

function PasswordField({
  value,
  onChange,
  revealing,
  onToggleReveal,
}: {
  value: string
  onChange: (v: string) => void
  revealing: boolean
  onToggleReveal: () => void
}) {
  return (
    <label className="grid grid-cols-[60px_1fr] items-center gap-2 text-xs text-stone-400">
      <span className="text-stone-500">Password</span>
      <div className="relative">
        <input
          type={revealing ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pr-9 pl-2 py-1.5 rounded-md bg-stone-900 border border-stone-700 text-stone-100 placeholder-stone-600 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/60 focus:border-emerald-500/60"
        />
        <button
          type="button"
          onClick={onToggleReveal}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-stone-200 rounded"
          title={revealing ? 'Hide' : 'Reveal'}
        >
          {revealing ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    </label>
  )
}

function formatUpdatedAgo(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!ms) return null
  const diffMs = Date.now() - ms
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}
