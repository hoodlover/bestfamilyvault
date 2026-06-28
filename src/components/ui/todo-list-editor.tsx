'use client'

// Editor for a single todo list. Native <input type="checkbox"> on each
// row (per Lance's spec — no fake checkbox component), inline title
// editing, Enter creates the next row (auto-focused), and a one-tap
// "delete checked" button that wipes every ticked row at once.
//
// All mutations go through server actions in lib/actions/todos.ts. The
// optimistic state means the keyboard never collapses while the round
// trip resolves, but each action is awaited so a save error reverts.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Pencil, Check } from 'lucide-react'
import {
  addTodoItem,
  deleteCheckedTodoItems,
  deleteTodoItem,
  deleteTodoList,
  renameTodoList,
  toggleTodoItem,
  updateTodoItem,
} from '@/lib/actions/todos'
import { compareTodoItems } from '@/lib/todo-sort'

interface Item {
  id: string
  text: string
  isChecked: boolean
  sortOrder: number
}

interface Props {
  list: {
    id: string
    title: string
    items: Item[]
  }
}

export function TodoListEditor({ list }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [items, setItems] = useState<Item[]>(list.items)
  const [title, setTitle] = useState(list.title)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(list.title)
  const [newText, setNewText] = useState('')
  const newRowRef = useRef<HTMLInputElement | null>(null)

  const hasChecked = items.some((i) => i.isChecked)
  // Sort lives in render-time memo so every optimistic flag flip
  // (checkbox, star, priority) re-flows the order without an extra
  // setItems round-trip. compareTodoItems is the same comparator the
  // server uses on read, so the optimistic order matches what comes
  // back on refresh.
  const sortedItems = useMemo(() => [...items].sort(compareTodoItems), [items])

  // Auto-focus the "new row" input on mount so the user can start typing
  // immediately — matches Lance's "ready to type" requirement for a
  // freshly-opened list.
  useEffect(() => {
    newRowRef.current?.focus()
  }, [])

  async function commitNew() {
    const text = newText.trim()
    if (!text) return
    setNewText('')
    const { id } = await addTodoItem(list.id, text)
    setItems((prev) => [
      ...prev,
      {
        id,
        text,
        isChecked: false,
        sortOrder: (prev[prev.length - 1]?.sortOrder ?? -1) + 1,
      },
    ])
    // Refocus immediately so a stream of items reads as a single typing
    // session — no need to re-tap the field between items.
    setTimeout(() => newRowRef.current?.focus(), 0)
  }

  async function commitToggle(itemId: string, isChecked: boolean) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, isChecked } : i)))
    await toggleTodoItem(itemId, isChecked)
    startTransition(() => router.refresh())
  }

  async function commitText(itemId: string, text: string) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, text } : i)))
    await updateTodoItem(itemId, text)
  }

  async function commitDelete(itemId: string) {
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    await deleteTodoItem(itemId)
  }

  async function commitClearChecked() {
    if (!hasChecked) return
    if (!confirm('Delete every checked item?')) return
    setItems((prev) => prev.filter((i) => !i.isChecked))
    await deleteCheckedTodoItems(list.id)
    startTransition(() => router.refresh())
  }

  async function commitRename() {
    const clean = titleDraft.trim()
    if (!clean) {
      setTitleDraft(title)
      setEditingTitle(false)
      return
    }
    setEditingTitle(false)
    if (clean === title) return
    setTitle(clean)
    await renameTodoList(list.id, clean)
  }

  async function commitDeleteList() {
    if (!confirm('Delete this list?')) return
    await deleteTodoList(list.id)
    router.push('/todos')
  }

  return (
    <div className="space-y-4">
      {/* Title row — single tap on the pencil flips into edit mode. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false) }
              }}
              autoFocus
              className="w-full px-2 py-1 -mx-2 bg-stone-800 border border-stone-600 rounded-md text-xl md:text-2xl font-bold text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-600/50"
            />
          ) : (
            <h1
              className="text-xl md:text-2xl font-bold text-stone-100 cursor-text break-words"
              onClick={() => { setTitleDraft(title); setEditingTitle(true) }}
            >
              {title}
            </h1>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => { setTitleDraft(title); setEditingTitle(true) }}
            aria-label="Rename"
            className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={commitDeleteList}
            aria-label="Delete list"
            title="Delete list"
            className="p-1.5 rounded text-stone-500 hover:text-red-400 hover:bg-stone-800 transition"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Items + the always-present "new item" row at the bottom. The
          new row is rendered last so the page reads as a contiguous list
          from top (oldest items) → bottom (active typing). */}
      <ul className="rounded-xl border border-stone-700/60 bg-stone-900/40 divide-y divide-stone-800">
        {sortedItems.map((it) => (
          <TodoRow
            key={it.id}
            item={it}
            onToggle={(checked) => commitToggle(it.id, checked)}
            onText={(t) => commitText(it.id, t)}
            onDelete={() => commitDelete(it.id)}
          />
        ))}
        <li className="flex items-center gap-3 px-3 py-2.5">
          <div className="w-5 h-5 shrink-0 rounded border border-stone-700 bg-stone-900" aria-hidden />
          <input
            ref={newRowRef}
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitNew() }
            }}
            placeholder="Add an item…"
            className="flex-1 min-w-0 bg-transparent border-0 text-sm text-stone-100 placeholder-stone-600 focus:outline-none"
          />
          {newText.trim() && (
            <button
              type="button"
              onClick={commitNew}
              aria-label="Add"
              className="p-1.5 rounded text-amber-400 hover:text-amber-300 hover:bg-stone-800 transition"
            >
              <Check size={15} />
            </button>
          )}
        </li>
      </ul>

      <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
        <span>
          {items.length === 0
            ? 'Empty'
            : `${items.filter((i) => i.isChecked).length} of ${items.length} done`}
        </span>
        {hasChecked && (
          <button
            type="button"
            onClick={commitClearChecked}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md text-red-300 bg-red-950/40 border border-red-800/40 hover:bg-red-900/40 transition"
          >
            <Trash2 size={12} />
            Delete checked
          </button>
        )}
      </div>
    </div>
  )
}

function TodoRow({
  item,
  onToggle,
  onText,
  onDelete,
}: {
  item: Item
  onToggle: (checked: boolean) => void
  onText: (text: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(item.text)
  // Track the last value we sent to the server so a no-op blur doesn't
  // round-trip. We also re-sync from props if the parent reloads (e.g.
  // after a router.refresh()) so this row mirrors server state.
  const [lastSaved, setLastSaved] = useState(item.text)
  useEffect(() => {
    setDraft(item.text)
    setLastSaved(item.text)
  }, [item.text])

  function commitDraft() {
    const clean = draft
    if (clean === lastSaved) return
    setLastSaved(clean)
    onText(clean)
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2.5 group">
      <input
        type="checkbox"
        checked={item.isChecked}
        onChange={(e) => onToggle(e.target.checked)}
        // Native checkbox per spec — sized to feel tappable on mobile.
        // Amber accent matches the To-Do section theme.
        className="w-5 h-5 shrink-0 accent-amber-500 cursor-pointer"
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
        }}
        className={`flex-1 min-w-0 bg-transparent border-0 text-sm focus:outline-none ${item.isChecked ? 'text-stone-500 line-through' : 'text-stone-100'}`}
      />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete item"
        className="p-1 text-stone-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
      >
        <Trash2 size={13} />
      </button>
    </li>
  )
}
