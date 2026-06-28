'use client'

// Single row on the /todos index — a whole list with its title, item
// counts, and the per-list star + priority toggles that float the row
// to the top when flipped on. The toggles are client-side optimistic;
// the surrounding Link is the primary clickable area that opens the
// list editor.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Star, Flag } from 'lucide-react'
import { setTodoListFavorite, setTodoListPriority } from '@/lib/actions/todos'

interface Props {
  list: {
    id: string
    title: string
    itemCount: number
    checkedCount: number
    isFavorite: boolean
    isPriority: boolean
    updatedAt: Date | string
  }
}

export function TodoListRow({ list }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [isFavorite, setIsFavorite] = useState(list.isFavorite)
  const [isPriority, setIsPriority] = useState(list.isPriority)

  const done = list.checkedCount
  const total = list.itemCount
  const allDone = total > 0 && done === total

  function toggleFav(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isFavorite
    setIsFavorite(next)
    setTodoListFavorite(list.id, next).then((res) => {
      if ('error' in res && res.error) {
        setIsFavorite(!next)
        return
      }
      startTransition(() => router.refresh())
    })
  }

  function togglePri(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isPriority
    setIsPriority(next)
    setTodoListPriority(list.id, next).then((res) => {
      if ('error' in res && res.error) {
        setIsPriority(!next)
        return
      }
      startTransition(() => router.refresh())
    })
  }

  return (
    <li className="flex items-stretch">
      <Link
        href={`/todos/${list.id}`}
        className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 hover:bg-stone-800/60 transition"
      >
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold truncate ${allDone ? 'text-stone-500 line-through' : 'text-stone-100'}`}>
            {list.title}
          </div>
          <div className="text-xs text-stone-500 truncate mt-0.5">
            {total === 0
              ? 'Empty'
              : `${done} of ${total} done · updated ${new Date(list.updatedAt).toLocaleDateString()}`}
          </div>
        </div>
        <ChevronRight size={16} className="text-stone-600 shrink-0" />
      </Link>
      {/* Star + priority sit OUTSIDE the Link so their clicks don't open
          the list. Both are opt-in: greyed off, colored on. Tapping
          re-floats the row via the server's order on the next refresh
          (and optimistically right now, since the parent list will
          re-sort once router.refresh lands fresh props). */}
      <div className="flex items-center gap-1 pr-2 shrink-0">
        <button
          type="button"
          onClick={togglePri}
          aria-pressed={isPriority}
          aria-label={isPriority ? 'Remove priority' : 'Mark priority'}
          title={isPriority ? 'Priority — tap to clear' : 'Mark priority'}
          className={`inline-flex items-center justify-center h-9 w-9 rounded-md transition ${
            isPriority ? 'text-red-400' : 'text-stone-600 hover:text-stone-300'
          }`}
        >
          <Flag size={14} className={isPriority ? 'fill-red-400' : ''} />
        </button>
        <button
          type="button"
          onClick={toggleFav}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
          title={isFavorite ? 'Favorite — tap to clear' : 'Favorite'}
          className={`inline-flex items-center justify-center h-9 w-9 rounded-md transition ${
            isFavorite ? 'text-[#d8a531]' : 'text-stone-600 hover:text-stone-300'
          }`}
        >
          <Star size={14} className={isFavorite ? 'fill-[#d8a531]' : ''} />
        </button>
      </div>
    </li>
  )
}
