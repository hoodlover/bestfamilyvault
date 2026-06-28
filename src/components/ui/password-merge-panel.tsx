'use client'

// Side-by-side merge panel — opened from /admin/password-cleanup when
// 2+ login rows are selected. For each field, the user picks which
// row's value should win (or types a custom value). On save, the
// keeper row gets the merged values and the others are CSV-snapshotted
// + deleted.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, Save, AlertTriangle, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { mergeAndDeleteLogins } from '@/lib/actions/password-cleanup'

export interface MergeRow {
  id: string
  title: string
  username: string | null
  password: string | null
  url: string | null
  categoryId: string
  category: string
  updatedAt: string | null
}

interface Props {
  rows: MergeRow[]
  onClose: () => void
}

type FieldKey = 'title' | 'username' | 'password' | 'url' | 'categoryId'

const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Title',
  username: 'Username',
  password: 'Password',
  url: 'URL',
  categoryId: 'Category',
}

export function PasswordMergePanel({ rows, onClose }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Pre-pick the keeper: most recently updated row.
  const newestRow = useMemo(() => {
    return rows.reduce((best, r) => {
      const a = best?.updatedAt ? Date.parse(best.updatedAt) : 0
      const b = r.updatedAt ? Date.parse(r.updatedAt) : 0
      return b > a ? r : best
    }, rows[0])
  }, [rows])
  const [keeperId, setKeeperId] = useState(newestRow.id)

  // Per-field picker state. Initialized to "keeper-or-first-non-empty"
  // so the save button works without user touching anything for the
  // common case where one row has the only non-empty value.
  const [picks, setPicks] = useState<Record<FieldKey, string | null>>(() =>
    initialPicks(rows, newestRow.id),
  )

  // "Don't throw away the losing values" mode. Use case: 3 versions of
  // the same login with different passwords, Lance isn't sure which is
  // current. Front-and-center keeps one set; the rest land in the
  // notes so he can still try them. Default on whenever there's
  // disagreement on the password — it's the high-value case and the
  // toggle is a no-op if nothing actually differs.
  const passwordsDiffer = useMemo(() => {
    const passes = new Set(rows.map((r) => normalizeValue(r.password)).filter((v) => v !== null))
    return passes.size >= 2
  }, [rows])
  const [preserveInNotes, setPreserveInNotes] = useState(passwordsDiffer)
  // Default off (Lance: "way too many excel files"). Notes preservation
  // already captures the discarded values for "try this if main fails"
  // recovery, so the CSV is genuinely a belt-and-suspenders extra now.
  const [wantsCsv, setWantsCsv] = useState(false)

  // Detect fields where every row already agrees — those don't need
  // user input, just show the value.
  const fieldStates = useMemo(() => {
    const state: Record<FieldKey, { unique: boolean; allEmpty: boolean }> = {
      title: { unique: false, allEmpty: false },
      username: { unique: false, allEmpty: false },
      password: { unique: false, allEmpty: false },
      url: { unique: false, allEmpty: false },
      categoryId: { unique: false, allEmpty: false },
    }
    for (const k of Object.keys(state) as FieldKey[]) {
      const vals = rows.map((r) => normalizeValue(r[k]))
      const distinct = new Set(vals.filter((v) => v !== null))
      state[k] = {
        unique: distinct.size <= 1,
        allEmpty: distinct.size === 0,
      }
    }
    return state
  }, [rows])

  function handleSave() {
    setError(null)
    const merged: {
      title?: string
      username?: string | null
      password?: string | null
      url?: string | null
      categoryId?: string
    } = {}
    // For title we never want null; fall back to keeper's title.
    const titlePick = picks.title ?? rows.find((r) => r.id === keeperId)?.title ?? ''
    merged.title = titlePick
    merged.username = picks.username
    merged.password = picks.password
    merged.url = picks.url
    if (picks.categoryId) merged.categoryId = picks.categoryId

    const deleteIds = rows.filter((r) => r.id !== keeperId).map((r) => r.id)

    startTransition(async () => {
      const res = await mergeAndDeleteLogins({ keeperId, merged, deleteIds, preserveInNotes, includeCsv: wantsCsv })
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.csv && res.filename) {
        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1500)
      }
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-stone-100">Merge {rows.length} entries</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Pick which value wins for each field. Keeper gets the merged values; the other{' '}
              {rows.length - 1} {rows.length - 1 === 1 ? 'entry' : 'entries'} get a CSV snapshot then deletion.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5">
          {/* Keeper picker */}
          <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3">
            <p className="text-[11px] uppercase tracking-wider text-emerald-300 font-semibold mb-2">
              Which entry should survive (be the keeper)?
            </p>
            <div className="space-y-1.5">
              {rows.map((r) => (
                <label
                  key={r.id}
                  className={clsx(
                    'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition',
                    keeperId === r.id ? 'bg-emerald-900/40' : 'hover:bg-stone-800/60',
                  )}
                >
                  <input
                    type="radio"
                    name="keeper"
                    checked={keeperId === r.id}
                    onChange={() => setKeeperId(r.id)}
                    className="accent-emerald-600"
                  />
                  <span className="text-sm text-stone-100 truncate flex-1">{r.title}</span>
                  <span className="text-[11px] text-stone-500 shrink-0">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Per-field picker */}
          {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => {
            const state = fieldStates[field]
            if (state.unique || state.allEmpty) {
              // No need to pick — display the unanimous value (or "(empty)").
              const v = state.allEmpty
                ? null
                : field === 'categoryId'
                  ? rows[0].category
                  : (rows[0][field] as string | null)
              return (
                <div key={field} className="rounded-xl border border-stone-800 bg-stone-900/40 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1">
                    {FIELD_LABELS[field]}
                  </p>
                  <p className="text-sm text-stone-200 font-mono break-all">
                    {v ?? <em className="text-stone-600 not-italic">(empty in all)</em>}
                  </p>
                  <p className="text-[10px] text-stone-600 mt-1">All rows agree — no pick needed.</p>
                </div>
              )
            }
            // Disagreement → show one option per row.
            return (
              <div key={field} className="rounded-xl border border-stone-800 bg-stone-900/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">
                  {FIELD_LABELS[field]}
                </p>
                <div className="grid gap-1.5">
                  {/* Show one row per source entry, with the value from that entry */}
                  {rows.map((r) => {
                    const rawValue =
                      field === 'categoryId'
                        ? r.categoryId
                        : (r[field] as string | null)
                    const displayValue =
                      field === 'categoryId' ? r.category : (rawValue ?? '')
                    const normalized = normalizeValue(rawValue)
                    const picked = picks[field] === normalized
                    return (
                      <label
                        key={`${r.id}-${field}`}
                        className={clsx(
                          'flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition border',
                          picked
                            ? 'border-emerald-600/60 bg-emerald-950/30'
                            : 'border-transparent hover:bg-stone-800/60',
                        )}
                      >
                        <input
                          type="radio"
                          name={`field-${field}`}
                          checked={picked}
                          onChange={() => setPicks((p) => ({ ...p, [field]: normalized }))}
                          className="accent-emerald-600 mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-stone-200 font-mono break-all">
                            {displayValue || <em className="text-stone-600 not-italic">(empty)</em>}
                          </p>
                          <p className="text-[10px] text-stone-500 truncate mt-0.5">from "{r.title}"</p>
                        </div>
                      </label>
                    )
                  })}
                  {/* "Empty" option for nullable fields — title isn't nullable. */}
                  {field !== 'title' && field !== 'categoryId' && (
                    <label
                      className={clsx(
                        'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition border',
                        picks[field] === null
                          ? 'border-emerald-600/60 bg-emerald-950/30'
                          : 'border-transparent hover:bg-stone-800/60',
                      )}
                    >
                      <input
                        type="radio"
                        name={`field-${field}`}
                        checked={picks[field] === null}
                        onChange={() => setPicks((p) => ({ ...p, [field]: null }))}
                        className="accent-emerald-600"
                      />
                      <span className="text-xs text-stone-500 italic">leave empty</span>
                    </label>
                  )}
                </div>
              </div>
            )
          })}

          {/* Preserve-in-notes toggle. Defaulted on when passwords differ
              across rows — that's the case Lance flagged ("save all three
              passwords in case the one I choose to keep is not it"). */}
          <label
            className={clsx(
              'flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition',
              preserveInNotes
                ? 'border-amber-600/50 bg-amber-950/20'
                : 'border-stone-800 bg-stone-900/40 hover:bg-stone-900/70',
            )}
          >
            <input
              type="checkbox"
              checked={preserveInNotes}
              onChange={(e) => setPreserveInNotes(e.target.checked)}
              className="mt-0.5 accent-amber-600 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-stone-100 flex items-center gap-1.5">
                <FileText size={13} className="text-amber-300" />
                Save the other values to notes
              </p>
              <p className="text-[11px] text-stone-400 mt-0.5 leading-snug">
                Before deleting, append every other entry's username / password / URL
                to the keeper's note field. Useful when you're not 100% sure which
                password is current — keep the picked one front-and-center but stash
                the others in case you need to try them.
              </p>
            </div>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/50 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-stone-800 shrink-0 bg-stone-950/40">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs text-stone-500 truncate">
              Keeper: <span className="text-stone-300">{rows.find((r) => r.id === keeperId)?.title}</span>
            </span>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-stone-500 cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={wantsCsv}
                onChange={(e) => setWantsCsv(e.target.checked)}
                className="accent-stone-500"
              />
              CSV backup
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-3 py-1.5 text-sm text-stone-300 hover:text-stone-100 transition disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-lg transition"
            >
              <Save size={14} />
              {pending ? 'Merging…' : `Save merged · delete ${rows.length - 1} others`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helpers — normalize empty strings to null so "" and null compare equal.
function normalizeValue(v: unknown): string | null {
  if (v == null) return null
  if (typeof v !== 'string') return String(v)
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

// Pre-pick values per field: prefer the keeper's value if non-null,
// else first non-null among the rest, else null.
function initialPicks(rows: MergeRow[], keeperId: string): Record<FieldKey, string | null> {
  const keeper = rows.find((r) => r.id === keeperId) ?? rows[0]
  const pick = (field: FieldKey): string | null => {
    const keeperVal =
      field === 'categoryId' ? keeper.categoryId : (keeper[field] as string | null)
    if (normalizeValue(keeperVal)) return normalizeValue(keeperVal)
    for (const r of rows) {
      if (r.id === keeperId) continue
      const v = field === 'categoryId' ? r.categoryId : (r[field] as string | null)
      const n = normalizeValue(v)
      if (n) return n
    }
    return null
  }
  return {
    title: pick('title'),
    username: pick('username'),
    password: pick('password'),
    url: pick('url'),
    categoryId: pick('categoryId'),
  }
}
