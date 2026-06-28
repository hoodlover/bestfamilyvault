'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Pencil, Check, X, Plus, Trash2, MoveRight, Upload, ArrowUp, ArrowDown } from 'lucide-react'
import { getCategoryIcon, getCategoryLabel, getSubcategoryIcon } from '@/lib/category-presentation'
import {
  updateCategoryName,
  uploadCategoryIcon,
  updateCategoryIcon,
  updateSubcategoryName,
  uploadSubcategoryIcon,
  updateSubcategoryIcon,
  addSubcategory,
  deleteSubcategory,
  moveSubcategory,
  promoteSubcategoryToCategory,
  reorderSubcategory,
  reorderCategory,
  addCategory,
  deleteCategory,
  moveCategoryContentsAndDelete,
  moveSubcategoryContentsAndDelete,
} from '@/lib/actions/admin'
import { IconPicker, type PickerIcon } from './icon-picker'
import { DeleteBlockedModal } from './delete-blocked-modal'

interface Sub {
  id: string
  name: string
  icon: string | null
  description: string | null
}

interface Cat {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  subs: Sub[]
}


function IconUpload({
  id,
  value,
  onUpload,
}: {
  id: string
  value: string | null
  onUpload: (formData: FormData) => Promise<{ error?: string; success?: boolean; icon?: string }>
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setError(null)
    const formData = new FormData()
    formData.append('id', id)
    formData.append('file', file)
    const res = await onUpload(formData)
    setUploading(false)
    if (res.error) { setError(res.error); return }
    router.refresh()
  }

  return (
    <span className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label={uploading ? 'Uploading icon' : 'Upload custom icon'}
        title={uploading ? 'Uploading…' : 'Upload custom icon'}
        className="flex shrink-0 items-center justify-center rounded-md border border-stone-700 px-1.5 py-1 text-xs text-stone-500 transition hover:border-emerald-700/60 hover:text-emerald-400 disabled:opacity-50"
      >
        {uploading ? (
          <span className="w-3 h-3 border border-stone-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <Upload size={12} />
        )}
      </button>
      {error && <span className="hidden md:inline max-w-40 truncate text-xs text-red-400" title={error}>{error}</span>}
    </span>
  )
}

function InlineEdit({
  value,
  onSave,
  onEditingChange,
}: {
  value: string
  onSave: (name: string) => Promise<{ error?: string }>
  /** Notifies the parent so it can hide neighboring tap targets (icon
   *  picker / upload / delete) while the name is being edited — those
   *  buttons sit right next to the green check and used to swallow taps. */
  onEditingChange?: (editing: boolean) => void
}) {
  const [editing, setEditingState] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setEditing(next: boolean) {
    setEditingState(next)
    onEditingChange?.(next)
  }

  async function save() {
    if (draft.trim() === value) { setEditing(false); return }
    setSaving(true)
    const res = await onSave(draft.trim())
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setEditing(false)
    setError(null)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setError(null)
  }

  if (editing) {
    return (
      <span className="flex items-center gap-2 flex-1 min-w-0">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="flex-1 min-w-0 px-2 py-1.5 bg-stone-700 border border-emerald-700/50 rounded text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
        {/* Bigger hit targets — these used to be 14×14 with no padding,
            which made them brutal to land on mobile next to the icon
            picker button. */}
        <button
          onClick={save}
          disabled={saving}
          aria-label="Save name"
          title="Save"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 hover:text-emerald-200 transition disabled:opacity-50 shrink-0"
        >
          <Check size={18} />
        </button>
        <button
          onClick={cancel}
          aria-label="Cancel edit"
          title="Cancel"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-stone-700/40 hover:bg-stone-700 text-stone-400 hover:text-stone-200 transition shrink-0"
        >
          <X size={18} />
        </button>
        {error && <span className="text-red-400 text-xs truncate">{error}</span>}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 group/edit min-w-0">
      <span className="truncate">{value}</span>
      <button
        onClick={() => { setDraft(value); setEditing(true) }}
        className="opacity-0 group-hover/edit:opacity-100 text-stone-500 hover:text-emerald-400 transition shrink-0"
      >
        <Pencil size={12} />
      </button>
    </span>
  )
}

interface DeleteBlock {
  kind: 'category' | 'subcategory'
  sourceId: string
  sourceName: string
  blockers: { entries?: number; notes?: number; files?: number; subcategories?: number }
  parentCategoryId?: string  // for subcategory deletes
}

export function CategoryEditor({ cats, cobbIcons }: { cats: Cat[]; cobbIcons: PickerIcon[] }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newSubName, setNewSubName] = useState('')
  const [movingSubId, setMovingSubId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null)
  const [savingCategory, setSavingCategory] = useState(false)
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null)
  // Tracks which row's name is currently being inline-edited (cat OR sub
  // by id). While set, that row hides its trailing icon-picker / upload /
  // delete controls so the green check has a clear hit target on mobile.
  const [editingNameId, setEditingNameId] = useState<string | null>(null)

  async function handleAddCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    setSavingCategory(true)
    setNewCategoryError(null)
    const res = await addCategory(name)
    setSavingCategory(false)
    if (res.error) {
      setNewCategoryError(res.error)
      return
    }
    setNewCategoryName('')
    setAddingCategory(false)
    startTransition(() => router.refresh())
  }

  async function handleDeleteCategory(catId: string, catName: string) {
    if (!confirm(`Delete "${catName}"? This cannot be undone.`)) return
    const res = await deleteCategory(catId)
    if (res && 'blocked' in res && res.blocked) {
      setDeleteBlock({
        kind: 'category',
        sourceId: catId,
        sourceName: catName,
        blockers: res.blockers,
      })
      return
    }
    if (res?.error) { alert(res.error); return }
    startTransition(() => router.refresh())
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAddSub(catId: string) {
    if (!newSubName.trim()) return
    await addSubcategory(catId, newSubName.trim())
    setAddingTo(null)
    setNewSubName('')
    startTransition(() => router.refresh())
  }

  async function handleDeleteSub(subId: string, subName: string, parentCategoryId: string) {
    if (!confirm(`Delete subcategory "${subName}"? This cannot be undone.`)) return
    const res = await deleteSubcategory(subId)
    if (res && 'blocked' in res && res.blocked) {
      setDeleteBlock({
        kind: 'subcategory',
        sourceId: subId,
        sourceName: subName,
        blockers: res.blockers,
        parentCategoryId,
      })
      return
    }
    if (res?.error) { alert(res.error); return }
    startTransition(() => router.refresh())
  }

  async function handleMoveSub(subId: string, newCatId: string) {
    if (!newCatId) return
    // Sentinel value emitted by the "↑ Promote to top-level" option in
    // the dropdown. Routes to the promotion action instead of a normal
    // re-parenting move.
    if (newCatId === '__PROMOTE__') {
      if (!confirm('Promote this subcategory to its own top-level category? Any entries / notes / nested subs filed under it will move with it.')) {
        setMovingSubId(null)
        return
      }
      const res = await promoteSubcategoryToCategory(subId)
      setMovingSubId(null)
      if (res?.error) alert(res.error)
      else startTransition(() => router.refresh())
      return
    }
    await moveSubcategory(subId, newCatId)
    setMovingSubId(null)
    startTransition(() => router.refresh())
  }

  async function handleReorderSub(subId: string, direction: 'up' | 'down') {
    await reorderSubcategory(subId, direction)
    startTransition(() => router.refresh())
  }

  async function handleReorderCat(catId: string, direction: 'up' | 'down') {
    await reorderCategory(catId, direction)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-1">
      {/* Add Category — superuser-only action surfaced at the top so it's always reachable */}
      {addingCategory ? (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-950/20 border border-emerald-700/40 rounded-xl">
          <Plus size={16} className="text-emerald-400 shrink-0" />
          <input
            autoFocus
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCategory()
              if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName(''); setNewCategoryError(null) }
            }}
            placeholder="New category name..."
            className="flex-1 px-2 py-1 bg-stone-800 border border-stone-700 rounded text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          />
          <button
            onClick={handleAddCategory}
            disabled={savingCategory || !newCategoryName.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded transition"
          >
            <Check size={13} />
            Save
          </button>
          <button
            onClick={() => { setAddingCategory(false); setNewCategoryName(''); setNewCategoryError(null) }}
            className="text-stone-500 hover:text-stone-300 transition"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
          {newCategoryError && <span className="text-xs text-red-400">{newCategoryError}</span>}
        </div>
      ) : (
        <button
          onClick={() => setAddingCategory(true)}
          className="flex items-center gap-2 w-full px-4 py-3 bg-stone-800/40 hover:bg-stone-800 border border-dashed border-stone-700 hover:border-emerald-700/60 rounded-xl text-sm text-stone-400 hover:text-emerald-300 transition"
        >
          <Plus size={16} />
          Add Category
        </button>
      )}

      {cats.map((cat, catIndex) => (
        <div key={cat.id} className="bg-stone-800/40 border border-stone-700/50 rounded-xl overflow-hidden">
          {/* Category row */}
          <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3">
            <button
              onClick={() => toggle(cat.id)}
              className="text-stone-500 hover:text-stone-300 transition shrink-0"
            >
              {expanded.has(cat.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
            <img src={getCategoryIcon(cat.slug, cat.icon)} width={28} height={28} alt="" className="object-contain shrink-0 rounded " />
            <div className="flex-1 min-w-0 text-sm font-medium text-stone-200">
              <InlineEdit
                value={getCategoryLabel(cat.slug, cat.name)}
                onSave={(name) => updateCategoryName(cat.id, name)}
                onEditingChange={(v) => setEditingNameId(v ? cat.id : null)}
              />
            </div>
            {editingNameId !== cat.id && (
              <>
                <IconPicker
                  value={cat.icon}
                  icons={cobbIcons}
                  onPick={async (iconPath) => {
                    const res = await updateCategoryIcon(cat.id, iconPath)
                    router.refresh()
                    return res
                  }}
                />
                <IconUpload id={cat.id} value={cat.icon} onUpload={uploadCategoryIcon} />
                <span className="hidden sm:inline text-xs text-stone-600 shrink-0">{cat.subs.length} sub{cat.subs.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={() => handleReorderCat(cat.id, 'up')}
                  disabled={catIndex === 0}
                  className="text-stone-600 hover:text-emerald-400 disabled:text-stone-800 disabled:hover:text-stone-800 transition p-1 shrink-0"
                  title="Move category up"
                  aria-label="Move category up"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => handleReorderCat(cat.id, 'down')}
                  disabled={catIndex === cats.length - 1}
                  className="text-stone-600 hover:text-emerald-400 disabled:text-stone-800 disabled:hover:text-stone-800 transition p-1 shrink-0"
                  title="Move category down"
                  aria-label="Move category down"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  onClick={() => { setAddingTo(cat.id); setExpanded((p) => new Set([...p, cat.id])) }}
                  className="text-stone-600 hover:text-emerald-400 transition shrink-0"
                  title="Add subcategory"
                >
                  <Plus size={14} />
                </button>
                <button
                  onClick={() => handleDeleteCategory(cat.id, getCategoryLabel(cat.slug, cat.name))}
                  className="text-stone-600 hover:text-red-400 transition shrink-0"
                  title="Delete category"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>

          {/* Subcategory rows */}
          {expanded.has(cat.id) && (
            <div className="border-t border-stone-700/50">
              {cat.subs.map((sub, index) => (
                <div key={sub.id} className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 pl-10 border-b border-stone-700/30 last:border-0 bg-stone-900/30 group/sub">
                  <span className="text-stone-500 text-xs shrink-0">-&gt;</span>
                  <img src={getSubcategoryIcon(cat.slug, sub.name, sub.icon)} width={20} height={20} alt="" className="object-contain rounded shrink-0" />
                  <div className="flex-1 min-w-0 text-sm text-stone-300">
                    <InlineEdit
                      value={sub.name}
                      onSave={(name) => updateSubcategoryName(sub.id, name)}
                      onEditingChange={(v) => setEditingNameId(v ? sub.id : null)}
                    />
                  </div>
                  {editingNameId !== sub.id && (
                    <>
                  <IconPicker
                    value={sub.icon}
                    icons={cobbIcons}
                    onPick={async (iconPath) => {
                      const res = await updateSubcategoryIcon(sub.id, iconPath)
                      router.refresh()
                      return res
                    }}
                  />
                  <IconUpload id={sub.id} value={sub.icon} onUpload={uploadSubcategoryIcon} />

                  {/* Move dropdown — always visible (used to be hover-only,
                      which meant mobile users couldn't reach it). */}
                  {movingSubId === sub.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        autoFocus
                        defaultValue=""
                        onChange={(e) => handleMoveSub(sub.id, e.target.value)}
                        className="text-xs bg-stone-700 border border-stone-600 text-stone-300 rounded px-2 py-1 focus:outline-none"
                      >
                        <option value="" disabled>Move to…</option>
                        {/* Promote-to-top-level option. Sentinel value routes
                            to a different server action in handleMoveSub. */}
                        <option value="__PROMOTE__">↑ Promote to top-level category</option>
                        <option value="" disabled>──────────</option>
                        {cats.filter((c) => c.id !== cat.id).map((c) => (
                          <option key={c.id} value={c.id}>{getCategoryLabel(c.slug, c.name)}</option>
                        ))}
                      </select>
                      <button onClick={() => setMovingSubId(null)} className="text-stone-500 hover:text-stone-300 transition">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleReorderSub(sub.id, 'up')}
                        disabled={index === 0}
                        className="text-stone-500 hover:text-emerald-400 disabled:text-stone-700 disabled:hover:text-stone-700 transition p-1"
                        title="Move up"
                        aria-label="Move subcategory up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        onClick={() => handleReorderSub(sub.id, 'down')}
                        disabled={index === cat.subs.length - 1}
                        className="text-stone-500 hover:text-emerald-400 disabled:text-stone-700 disabled:hover:text-stone-700 transition p-1"
                        title="Move down"
                        aria-label="Move subcategory down"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        onClick={() => setMovingSubId(sub.id)}
                        className="text-stone-500 hover:text-blue-400 transition p-1"
                        title="Move to another category"
                        aria-label="Move to another category"
                      >
                        <MoveRight size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteSub(sub.id, sub.name, cat.id)}
                        className="text-stone-500 hover:text-red-400 transition p-1"
                        title="Delete subcategory"
                        aria-label="Delete subcategory"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                    </>
                  )}
                </div>
              ))}

              {/* Add subcategory inline form */}
              {addingTo === cat.id && (
                <div className="flex items-center gap-2 px-4 py-2.5 pl-10 bg-stone-900/50 border-t border-stone-700/30">
                  <span className="text-stone-500 text-xs">↳</span>
                  <input
                    autoFocus
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSub(cat.id)
                      if (e.key === 'Escape') { setAddingTo(null); setNewSubName('') }
                    }}
                    placeholder="New subcategory name…"
                    className="flex-1 px-2 py-0.5 bg-stone-700 border border-emerald-700/50 rounded text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600"
                  />
                  <button
                    onClick={() => handleAddSub(cat.id)}
                    disabled={isPending}
                    className="text-emerald-400 hover:text-emerald-300 transition disabled:opacity-50"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => { setAddingTo(null); setNewSubName('') }}
                    className="text-stone-500 hover:text-stone-300 transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Empty state + add prompt */}
              {cat.subs.length === 0 && addingTo !== cat.id && (
                <div className="px-10 py-2.5 text-xs text-stone-600 bg-stone-900/30">
                  No subcategories.{' '}
                  <button
                    onClick={() => setAddingTo(cat.id)}
                    className="text-emerald-600 hover:text-emerald-400 transition"
                  >
                    Add one
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {deleteBlock && deleteBlock.kind === 'category' && (
        <DeleteBlockedModal
          kind="category"
          sourceName={deleteBlock.sourceName}
          sourceId={deleteBlock.sourceId}
          blockers={deleteBlock.blockers}
          targets={cats
            .filter((c) => c.id !== deleteBlock.sourceId)
            .map((c) => ({ id: c.id, name: getCategoryLabel(c.slug, c.name) }))}
          reclassifyHref="/admin/reclassify"
          onMoveAll={async (targetId) => {
            if (!targetId) return { error: 'Pick a destination category.' }
            return moveCategoryContentsAndDelete(deleteBlock.sourceId, targetId)
          }}
          onClose={() => setDeleteBlock(null)}
        />
      )}

      {deleteBlock && deleteBlock.kind === 'subcategory' && (
        <DeleteBlockedModal
          kind="subcategory"
          sourceName={deleteBlock.sourceName}
          sourceId={deleteBlock.sourceId}
          blockers={deleteBlock.blockers}
          // Sibling subs only — moving cross-category requires moving the
          // sub itself first (the action enforces that). "No subcategory"
          // is the un-categorize escape hatch.
          targets={
            cats
              .find((c) => c.id === deleteBlock.parentCategoryId)
              ?.subs.filter((s) => s.id !== deleteBlock.sourceId)
              .map((s) => ({ id: s.id, name: s.name })) ?? []
          }
          allowNoTarget
          reclassifyHref="/admin/reclassify"
          onMoveAll={async (targetId) => moveSubcategoryContentsAndDelete(deleteBlock.sourceId, targetId)}
          onClose={() => setDeleteBlock(null)}
        />
      )}
    </div>
  )
}
