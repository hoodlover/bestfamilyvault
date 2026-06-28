'use client'

// Quick-Pick: grid of every staple grouped by category. Tick the
// regulars, add per-category specifics, type any one-offs at the
// bottom, hit "Add to list" — everything becomes manual entries on
// the meal plan's shopping list in one round-trip.
//
// "Edit list" toggle flips the page into manage mode: rename / delete
// items inline, add a new item per category. The list is family-wide
// (one shared set) and lives in quick_pick_item DB rows.

import Link from 'next/link'
import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Pencil, Plus, ShoppingCart, Trash2, X } from 'lucide-react'
import { addBulkManualItems } from '@/lib/actions/meal-plan'
import type { ShoppingListRow } from '@/lib/actions/shopping-lists'
import {
  addQuickPickItem,
  deleteQuickPickItem,
  renameQuickPickItem,
  type QuickPickItemRow,
} from '@/lib/actions/quick-pick'
import { HelpPopout } from './help-popout'

interface Props {
  initialItems: QuickPickItemRow[]
  canEdit: boolean
  lists: ShoppingListRow[]
  defaultListId: string
}

export function QuickPick({ initialItems, canEdit, lists, defaultListId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [destListId, setDestListId] = useState(defaultListId)

  // ticked staples: lookup by item id since names are no longer
  // guaranteed unique across categories once users edit the list.
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  // Per-category specifics text. Empty string = nothing to add.
  const [specifics, setSpecifics] = useState<Record<string, string>>({})

  // Bottom write-ins: dynamic list of inputs, start with one.
  const [writeIns, setWriteIns] = useState<string[]>([''])

  // Inline rename state for edit mode.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  // Per-category "+ add new item" input state.
  const [addText, setAddText] = useState<Record<string, string>>({})

  // Group items by category, preserving order from the array.
  const grouped = useMemo(() => {
    const map = new Map<string, QuickPickItemRow[]>()
    for (const it of initialItems) {
      const arr = map.get(it.category) ?? []
      arr.push(it)
      map.set(it.category, arr)
    }
    return Array.from(map.entries()).map(([category, items]) => ({ category, items }))
  }, [initialItems])

  function toggle(id: string) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setSpecific(cat: string, value: string) {
    setSpecifics((prev) => ({ ...prev, [cat]: value }))
  }

  function setWriteIn(i: number, value: string) {
    setWriteIns((prev) => {
      const next = [...prev]
      next[i] = value
      return next
    })
  }

  function addWriteIn() {
    setWriteIns((prev) => [...prev, ''])
  }

  function removeWriteIn(i: number) {
    setWriteIns((prev) => prev.filter((_, idx) => idx !== i))
  }

  // Items to submit on "Add to shopping list".
  const toSubmit = useMemo(() => {
    const out: string[] = []
    for (const g of grouped) {
      for (const it of g.items) {
        if (ticked.has(it.id)) out.push(it.name)
      }
      const spec = (specifics[g.category] ?? '').trim()
      if (spec) out.push(spec)
    }
    for (const w of writeIns) {
      const t = w.trim()
      if (t) out.push(t)
    }
    return out
  }, [grouped, ticked, specifics, writeIns])

  function submit() {
    if (toSubmit.length === 0) return
    startTransition(async () => {
      const res = await addBulkManualItems(toSubmit, destListId)
      if (res?.inserted != null) setSubmitted(res.inserted)
      setTicked(new Set())
      setSpecifics({})
      setWriteIns([''])
      router.refresh()
    })
  }

  const destListName = lists.find((l) => l.id === destListId)?.name ?? 'list'

  // ─── Edit-mode actions ─────────────────────────────────────────

  function startRename(it: QuickPickItemRow) {
    setRenamingId(it.id)
    setRenameText(it.name)
    setTimeout(() => { renameRef.current?.focus(); renameRef.current?.select() }, 0)
  }
  function commitRename(id: string) {
    const next = renameText.trim()
    if (!next) { setRenamingId(null); return }
    startTransition(async () => {
      await renameQuickPickItem(id, next)
      setRenamingId(null)
      setRenameText('')
      router.refresh()
    })
  }
  function cancelRename() { setRenamingId(null); setRenameText('') }

  function deleteItem(id: string) {
    if (!confirm('Delete this item from the Quick-Pick list?')) return
    startTransition(async () => {
      await deleteQuickPickItem(id)
      // Drop from tick set too, in case it was selected.
      setTicked((prev) => { const next = new Set(prev); next.delete(id); return next })
      router.refresh()
    })
  }

  function setAddTextFor(cat: string, value: string) {
    setAddText((prev) => ({ ...prev, [cat]: value }))
  }
  function commitAdd(cat: string) {
    const n = (addText[cat] ?? '').trim()
    if (!n) return
    startTransition(async () => {
      await addQuickPickItem(cat, n)
      setAddText((prev) => ({ ...prev, [cat]: '' }))
      router.refresh()
    })
  }

  const tickedCount = ticked.size
  const specCount = Object.values(specifics).filter((s) => s.trim()).length
  const writeCount = writeIns.filter((w) => w.trim()).length
  const totalCount = tickedCount + specCount + writeCount

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/meal-plan"
          className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200 transition"
        >
          <ArrowLeft size={14} />
          Back to plan
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg md:text-xl font-bold text-stone-100">Quick-Pick</h1>
          <HelpPopout
            title="Quick-Pick"
            sections={[
              {
                heading: 'Pick staples',
                tips: [
                  { title: 'Tick checkboxes', description: '16 categories of common staples. Tick anything you need for this trip.' },
                  { title: 'Specifics input', description: 'Per-category text box below each grid — type "Honeycrisp apples" or "favorite cookies". Goes on the list as-is when you submit.' },
                  { title: '+ Add another', description: 'Write-in section at the bottom for anything not on the staples list.' },
                ],
              },
              {
                heading: 'Destination',
                tips: [
                  { title: 'Add to: dropdown', description: 'Appears when you have more than one list. Picks which list the batch lands on (Weekly shop, road trip, Meal Plan…).' },
                  { title: 'One bulk insert', description: 'Hitting "Add to list" sends every ticked item + specifics + write-ins in a single round-trip.' },
                ],
              },
              {
                heading: 'Edit the staples list',
                tips: [
                  { title: 'Edit list button', description: 'Top-right pencil → manage mode. Click any name to rename, trash icon to delete, "+ Add an item to <Category>" per section.' },
                  { title: 'Family-shared', description: 'One staple list per account, shared across all family members on that login. Tweaks survive across visits.' },
                ],
              },
            ]}
          />
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition ${
              editMode
                ? 'bg-amber-700/30 border-amber-700/60 text-amber-200'
                : 'bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-600'
            }`}
          >
            {editMode ? <Check size={13} /> : <Pencil size={13} />}
            {editMode ? 'Done' : 'Edit list'}
          </button>
        ) : (
          <div className="w-20" />
        )}
      </div>

      <p className="text-sm text-stone-400">
        {editMode
          ? 'Add, rename, or delete items. Changes save automatically. Hit Done when finished.'
          : 'Tick anything you need. Add per-category specifics, then any one-offs at the bottom. Everything gets added in one shot.'}
      </p>

      {submitted != null && !editMode && (
        <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
          ✔ Added {submitted} item{submitted === 1 ? '' : 's'} to the shopping list.{' '}
          <Link href="/meal-plan/grocery" className="underline hover:text-emerald-100">
            View list →
          </Link>
        </div>
      )}

      {/* Category sections */}
      {grouped.map((g) => (
        <section key={g.category} className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4 space-y-2">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
            {g.category}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {g.items.map((it) => {
              const checked = ticked.has(it.id)
              const isRenaming = renamingId === it.id

              if (editMode) {
                return (
                  <div
                    key={it.id}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg border bg-stone-800 border-stone-700 text-sm text-stone-300"
                  >
                    {isRenaming ? (
                      <input
                        ref={renameRef}
                        type="text"
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(it.id) }
                          else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                        }}
                        onBlur={() => commitRename(it.id)}
                        className="flex-1 min-w-0 px-1.5 py-0.5 bg-stone-900 border border-emerald-700 rounded text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(it)}
                        className="flex-1 min-w-0 text-left truncate hover:text-emerald-300"
                        title="Rename"
                      >
                        {it.name}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteItem(it.id)}
                      title="Delete"
                      aria-label={`Delete ${it.name}`}
                      className="shrink-0 p-1 text-stone-500 hover:text-red-400 transition rounded"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              }

              return (
                <label
                  key={it.id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm cursor-pointer transition ${
                    checked
                      ? 'text-white'
                      : 'bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-600'
                  }`}
                  // Ticked staples fill with the theme accent — clear
                  // "this one's going on the list" signal. Inline style
                  // + CSS vars so the color renders regardless of which
                  // CSS chunk the PWA happens to have cached.
                  style={
                    checked
                      ? {
                          backgroundColor: 'rgb(var(--accent-600))',
                          borderColor: 'rgb(var(--accent-400))',
                          boxShadow: '0 0 10px rgb(var(--accent-300) / 0.3)',
                        }
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(it.id)}
                    className="h-4 w-4 rounded border-stone-600 bg-stone-900 text-emerald-600 focus:ring-emerald-600/50 focus:ring-offset-0 shrink-0"
                  />
                  <span className="truncate">{it.name}</span>
                </label>
              )
            })}
          </div>

          {editMode ? (
            <form
              onSubmit={(e) => { e.preventDefault(); commitAdd(g.category) }}
              className="flex items-center gap-2 mt-1"
            >
              <input
                type="text"
                value={addText[g.category] ?? ''}
                onChange={(e) => setAddTextFor(g.category, e.target.value)}
                placeholder={`+ Add an item to ${g.category}…`}
                className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
              />
              <button
                type="submit"
                disabled={isPending || !(addText[g.category] ?? '').trim()}
                className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
                aria-label="Add item"
              >
                <Plus size={14} />
              </button>
            </form>
          ) : (
            <input
              type="text"
              value={specifics[g.category] ?? ''}
              onChange={(e) => setSpecific(g.category, e.target.value)}
              placeholder={`Specifics for ${g.category.toLowerCase()} (e.g. "Honeycrisp apples")…`}
              className="w-full mt-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            />
          )}
        </section>
      ))}

      {/* Write-ins — hidden in edit mode (they're a per-trip thing, not part of the master list) */}
      {!editMode && (
        <section className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4 space-y-2">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
            Anything else
          </h2>
          <div className="space-y-2">
            {writeIns.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={w}
                  onChange={(e) => setWriteIn(i, e.target.value)}
                  placeholder="Type an item…"
                  className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
                />
                {writeIns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeWriteIn(i)}
                    className="text-stone-500 hover:text-red-400 transition p-1.5"
                    aria-label="Remove this write-in"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addWriteIn}
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
          >
            <Plus size={12} />
            Add another
          </button>
        </section>
      )}

      {/* Sticky submit bar — hidden in edit mode */}
      {!editMode && (
        <div
          className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-stone-950/95 backdrop-blur border-t border-stone-800 space-y-2"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-stone-400">
              {totalCount === 0
                ? 'Nothing picked yet'
                : `${totalCount} item${totalCount === 1 ? '' : 's'} ready`}
            </span>
            {/* Destination list picker. Defaults to the page's
                ?list=<id> (or the auto-list when none). When the user
                has only one list there's nothing to switch — hide. */}
            {lists.length > 1 && (
              <label className="text-xs text-stone-500 inline-flex items-center gap-1.5">
                Add to:
                <select
                  value={destListId}
                  onChange={(e) => setDestListId(e.target.value)}
                  className="px-2 py-1 bg-stone-800 border border-stone-700 rounded text-stone-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-600"
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || totalCount === 0}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
          >
            <ShoppingCart size={14} />
            {isPending
              ? 'Adding…'
              : lists.length > 1
                ? `Add to ${destListName}`
                : 'Add to shopping list'}
          </button>
        </div>
      )}
    </div>
  )
}
