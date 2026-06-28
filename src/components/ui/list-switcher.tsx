'use client'

// List switcher pill at the top of /meal-plan/grocery. Shows the
// currently-active shopping list, opens a dropdown of all lists to
// switch (?list=<id> URL state), and exposes "+ New list", rename,
// delete, and clear from the same dropdown.

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, ChevronDown, ListPlus, Pencil, Trash2, X } from 'lucide-react'
import {
  clearShoppingList,
  createShoppingList,
  deleteShoppingList,
  renameShoppingList,
  type ShoppingListRow,
} from '@/lib/actions/shopping-lists'

interface Props {
  lists: ShoppingListRow[]
  activeListId: string
  activeListName: string
  activeIsAuto: boolean
}

export function ListSwitcher({ lists, activeListId, activeListName, activeIsAuto }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setRenaming(false)
        setAdding(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function switchTo(listId: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (listId === lists.find((l) => l.isAutoMealPlan)?.id) {
      params.delete('list')
    } else {
      params.set('list', listId)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    setOpen(false)
  }

  function startRename() {
    setRenameText(activeListName)
    setRenaming(true)
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 0)
  }
  function commitRename() {
    const n = renameText.trim()
    if (!n || n === activeListName) { setRenaming(false); return }
    startTransition(async () => {
      await renameShoppingList(activeListId, n)
      setRenaming(false)
      router.refresh()
    })
  }

  function startAdd() {
    setAddText('')
    setAdding(true)
    setTimeout(() => addInputRef.current?.focus(), 0)
  }
  function commitAdd() {
    const n = addText.trim()
    if (!n) { setAdding(false); return }
    startTransition(async () => {
      const res = await createShoppingList(n)
      setAdding(false)
      setAddText('')
      if (res?.id) {
        // Switch to the newly created list right away.
        const params = new URLSearchParams(searchParams.toString())
        params.set('list', res.id)
        router.push(`${pathname}?${params.toString()}`)
      } else {
        router.refresh()
      }
    })
  }

  function doDelete() {
    if (!confirm(`Delete "${activeListName}" and all its items?`)) return
    startTransition(async () => {
      await deleteShoppingList(activeListId)
      // Drop list param so we fall back to the auto-list.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('list')
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function doClear() {
    const label = activeIsAuto ? 'all items from this list' : `all items in "${activeListName}"`
    if (!confirm(`Clear ${label}?`)) return
    startTransition(async () => {
      await clearShoppingList(activeListId)
      router.refresh()
    })
  }

  return (
    <div ref={wrapperRef} className="relative mb-4 print-hide">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm transition w-full sm:w-auto"
      >
        <span className="text-xs uppercase tracking-wider text-stone-500">List</span>
        <span className="font-semibold truncate">{activeListName}</span>
        <ChevronDown size={14} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full sm:w-72 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl py-1.5">
          {/* List of lists */}
          <ul className="max-h-72 overflow-y-auto">
            {lists.map((l) => {
              const active = l.id === activeListId
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => switchTo(l.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-stone-800 transition flex items-center gap-2 ${
                      active ? 'text-emerald-200' : 'text-stone-200'
                    }`}
                  >
                    {active ? <Check size={14} className="text-emerald-400 shrink-0" /> : <span className="w-3.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      <div className="text-[10px] text-stone-500">
                        {l.uncheckedCount} unchecked
                        {l.itemCount !== l.uncheckedCount && ` · ${l.itemCount} total`}
                        {l.isAutoMealPlan && ' · auto'}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="border-t border-stone-800 my-1" />

          {/* + New list */}
          {adding ? (
            <form
              onSubmit={(e) => { e.preventDefault(); commitAdd() }}
              className="px-2 py-1.5 flex items-center gap-1.5"
            >
              <input
                ref={addInputRef}
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false) }}
                placeholder="New list name"
                className="flex-1 px-2 py-1 bg-stone-800 border border-stone-700 rounded text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
              <button
                type="submit"
                disabled={isPending || !addText.trim()}
                className="px-2 py-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-40"
              >
                Add
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={startAdd}
              className="w-full text-left px-3 py-2 hover:bg-stone-800 transition flex items-center gap-2 text-emerald-300"
            >
              <ListPlus size={14} className="shrink-0" />
              <span className="text-sm">New list…</span>
            </button>
          )}

          {/* Rename / delete / clear for the ACTIVE list */}
          <div className="border-t border-stone-800 my-1" />
          {renaming ? (
            <form
              onSubmit={(e) => { e.preventDefault(); commitRename() }}
              className="px-2 py-1.5 flex items-center gap-1.5"
            >
              <input
                ref={renameInputRef}
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false) }}
                placeholder="Rename list"
                className="flex-1 px-2 py-1 bg-stone-800 border border-stone-700 rounded text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
              <button
                type="submit"
                disabled={isPending}
                className="px-2 py-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200 disabled:opacity-40"
              >
                Save
              </button>
            </form>
          ) : (
            <>
              {!activeIsAuto && (
                <button
                  type="button"
                  onClick={startRename}
                  className="w-full text-left px-3 py-2 hover:bg-stone-800 transition flex items-center gap-2 text-stone-300"
                >
                  <Pencil size={13} className="shrink-0" />
                  <span className="text-sm">Rename &ldquo;{activeListName}&rdquo;</span>
                </button>
              )}
              <button
                type="button"
                onClick={doClear}
                disabled={isPending}
                className="w-full text-left px-3 py-2 hover:bg-stone-800 transition flex items-center gap-2 text-stone-300 disabled:opacity-40"
              >
                <X size={13} className="shrink-0" />
                <span className="text-sm">Clear all items in this list</span>
              </button>
              {!activeIsAuto && (
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={isPending}
                  className="w-full text-left px-3 py-2 hover:bg-stone-800 transition flex items-center gap-2 text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={13} className="shrink-0" />
                  <span className="text-sm">Delete &ldquo;{activeListName}&rdquo;</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
