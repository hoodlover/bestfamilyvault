'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import { EntryCard } from './entry-card'
import { GroupedEntryCard } from './grouped-entry-card'
import { bulkMoveEntries, mergeEntries } from '@/lib/actions/entries'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries, categories, subcategories } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>
type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

interface Props {
  entries: Entry[]          // top-level entries only (parentEntryId = null)
  childrenMap: Record<string, Entry[]>  // parentId → child entries
  allCategories: Category[]
  allSubcategories: Subcategory[]
  categoryName: string
  subMap: Record<string, string>
  statusIcon?: string
  canEdit: boolean
  categoryId: string
  newEntryHref: string
  categoryLabelById?: Record<string, string>
  /** entryId → URL of the first image attachment for that entry (auth'd
   *  via /api/files/<id>?preview=1). When present, EntryCard renders an
   *  inline thumbnail instead of the generic type icon. */
  previewByEntryId?: Record<string, string>
  /** entryId → total attached file count. Drives the small paperclip
   *  chip in the card header so you can spot which entries already
   *  have a statement / scan on them. Missing entries render no chip. */
  attachmentCountByEntryId?: Record<string, number>
}

export function EntryGrid({
  entries,
  childrenMap,
  allCategories,
  allSubcategories,
  categoryName,
  subMap,
  statusIcon = '/icons/cobb/privatevault.png',
  canEdit,
  categoryId,
  newEntryHref,
  categoryLabelById,
  previewByEntryId,
  attachmentCountByEntryId,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetCatId, setTargetCatId] = useState('')
  const [targetSubId, setTargetSubId] = useState('')
  const [action, setAction] = useState<'move' | 'merge'>('move')

  const filteredSubs = allSubcategories.filter((s) => s.categoryId === targetCatId)
  const categorySlugById = Object.fromEntries(allCategories.map((c) => [c.id, c.slug]))
  const allSelected = selectedIds.size === entries.length && entries.length > 0

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(entries.map((e) => e.id)))
  }

  function cancelSelect() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setTargetCatId('')
    setTargetSubId('')
    setAction('move')
  }

  function handleMove() {
    if (!targetCatId || selectedIds.size === 0) return
    startTransition(async () => {
      await bulkMoveEntries([...selectedIds], targetCatId, targetSubId || null)
      cancelSelect()
      router.refresh()
    })
  }

  function handleMerge() {
    if (selectedIds.size < 2) return
    startTransition(async () => {
      await mergeEntries([...selectedIds])
      cancelSelect()
      router.refresh()
    })
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-stone-500 border border-stone-800 rounded-xl mb-8">
        <img src={statusIcon} width={64} height={64} alt="" className="object-contain mx-auto mb-3 rounded " />
        <p className="font-medium text-stone-400">No entries yet.</p>
        <Link href={newEntryHref} className="mt-2 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition">
          + Add first entry
        </Link>
      </div>
    )
  }

  return (
    <>
      {/* Row: compact count + select toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900/40 px-2 py-1 text-xs text-stone-500">
          <span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {selectMode && (
              <button type="button" onClick={toggleAll} className="text-xs text-stone-400 hover:text-stone-200 transition">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
            <button
              type="button"
              onClick={() => (selectMode ? cancelSelect() : setSelectMode(true))}
              className={clsx(
                'text-xs px-3 py-1.5 rounded-lg border transition',
                selectMode
                  ? 'bg-stone-700 border-stone-600 text-stone-300'
                  : 'border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600'
              )}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 mb-8">
        {entries.map((entry) => {
          const children = childrenMap[entry.id] ?? []
          if (children.length > 0) {
            return (
              <GroupedEntryCard
                key={entry.id}
                parent={entry}
                childEntries={children}
                canEdit={canEdit && !selectMode}
              />
            )
          }
          return (
            <EntryCard
              key={entry.id}
              entry={entry}
              categoryName={categoryLabelById?.[entry.categoryId] ?? categoryName}
              subcategoryName={entry.subcategoryId ? subMap[entry.subcategoryId] : undefined}
              canEdit={canEdit}
              selectMode={selectMode}
              selected={selectedIds.has(entry.id)}
              onSelect={toggleSelect}
              previewImageUrl={previewByEntryId?.[entry.id]}
              attachmentCount={attachmentCountByEntryId?.[entry.id]}
            />
          )
        })}
      </div>

      {/* Sticky action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-[60] p-4 bg-stone-950/95 backdrop-blur border-t border-stone-700/60">
          <div className="max-w-6xl mx-auto flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-emerald-400 shrink-0">
              {selectedIds.size} selected
            </span>
            <span className="text-stone-600">·</span>

            {/* Action toggle */}
            <div className="flex gap-1 bg-stone-800 rounded-lg p-0.5">
              <button
                onClick={() => setAction('move')}
                className={clsx('text-xs px-2.5 py-1 rounded-md transition', action === 'move' ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300')}
              >Move</button>
              <button
                onClick={() => setAction('merge')}
                className={clsx('text-xs px-2.5 py-1 rounded-md transition', action === 'merge' ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300')}
              >Merge</button>
            </div>

            {action === 'move' && (
              <>
                <select
                  value={targetCatId}
                  onChange={(e) => { setTargetCatId(e.target.value); setTargetSubId('') }}
                  className="px-2 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
                >
                  <option value="">— Category —</option>
                  {allCategories.map((c) => (
                    <option key={c.id} value={c.id}>{categoryLabelById?.[c.id] ?? c.name}</option>
                  ))}
                </select>
                {filteredSubs.length > 0 && (
                  <select
                    value={targetSubId}
                    onChange={(e) => setTargetSubId(e.target.value)}
                    className="px-2 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
                  >
                    <option value="">— Subcategory (optional) —</option>
                    {filteredSubs.map((s) => (
                      <option key={s.id} value={s.id}>{getSubcategoryLabel(categorySlugById[s.categoryId] ?? '', s.name)}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleMove}
                  disabled={!targetCatId || isPending}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
                >
                  {isPending ? 'Moving...' : 'Move'}
                </button>
              </>
            )}

            {action === 'merge' && (
              <>
                <span className="text-xs text-stone-400">
                  {selectedIds.size >= 2
                    ? `Merge ${selectedIds.size} entries into one grouped card`
                    : 'Select at least 2 entries'}
                </span>
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={selectedIds.size < 2 || isPending}
                  className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
                >
                  {isPending ? 'Merging...' : 'Merge'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
