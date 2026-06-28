// Shared comparator for todo items. Lives outside the 'use server'
// actions module because Next.js requires server-action files to export
// only async functions — a sync comparator imported by client code from
// such a module gets flagged at build time.
//
// Sort order:
//   1. Unchecked items first (checked drift to the bottom).
//   2. Then by the user's manual sortOrder (insertion sequence).
//   3. Tiebreaker on createdAt so two items with identical state still
//      render deterministically across reads.
//
// Per-item favorite + priority were removed in favor of per-LIST flags
// on the /todos index (Lance's call — too noisy at the row level). The
// is_favorite/is_priority columns on todo_item are kept (no destructive
// drop) but no longer participate in the sort.

export interface TodoSortable {
  isChecked: boolean
  sortOrder: number
  createdAt?: Date | string
}

export function compareTodoItems(a: TodoSortable, b: TodoSortable): number {
  if (a.isChecked !== b.isChecked) return a.isChecked ? 1 : -1
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
  return aTime - bTime
}
