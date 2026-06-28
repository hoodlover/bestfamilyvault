'use server'

// Todo lists — server actions. Each list is scoped to its creator
// (no cross-user sharing); items inherit visibility through the list FK.
// All mutations call revalidatePath('/todos') so the list view stays
// fresh after every edit; the per-list view revalidates itself via
// useRouter.refresh() since its URL is dynamic.

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { reminders, todoItems, todoLists } from '@/lib/db/schema'
import { compareTodoItems } from '@/lib/todo-sort'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role === 'readonly') throw new Error('Read-only access.')
  return session.user
}

function defaultTitle(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const y = String(d.getFullYear()).slice(-2)
  return `${m}/${day}/${y} To Do`
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export interface TodoListSummary {
  id: string
  title: string
  itemCount: number
  checkedCount: number
  isFavorite: boolean
  isPriority: boolean
  updatedAt: Date
}

export async function listMyTodoLists(): Promise<TodoListSummary[]> {
  const user = await requireUser()
  const lists = await db
    .select()
    .from(todoLists)
    .where(eq(todoLists.userId, user.id))
    // Priority + favorite float a list to the top; ties broken by
    // updatedAt desc (most-recently touched feels most relevant).
    .orderBy(desc(todoLists.isPriority), desc(todoLists.isFavorite), desc(todoLists.updatedAt))

  if (lists.length === 0) return []

  // Single batch fetch for item counts so opening /todos with N lists
  // is one query, not N.
  const ids = lists.map((l) => l.id)
  const items = await db
    .select({
      listId: todoItems.listId,
      isChecked: todoItems.isChecked,
    })
    .from(todoItems)
    .where(inArray(todoItems.listId, ids))

  const counts = new Map<string, { total: number; checked: number }>()
  for (const it of items) {
    const c = counts.get(it.listId) ?? { total: 0, checked: 0 }
    c.total += 1
    if (it.isChecked) c.checked += 1
    counts.set(it.listId, c)
  }

  return lists.map((l) => {
    const c = counts.get(l.id) ?? { total: 0, checked: 0 }
    return {
      id: l.id,
      title: l.title,
      itemCount: c.total,
      checkedCount: c.checked,
      isFavorite: l.isFavorite,
      isPriority: l.isPriority,
      updatedAt: l.updatedAt,
    }
  })
}

export interface TodoListWithItems {
  id: string
  title: string
  items: Array<{
    id: string
    text: string
    isChecked: boolean
    sortOrder: number
  }>
}

export async function getMyTodoList(listId: string): Promise<TodoListWithItems | null> {
  const user = await requireUser()
  const list = await db
    .select()
    .from(todoLists)
    .where(and(eq(todoLists.id, listId), eq(todoLists.userId, user.id)))
    .then((r) => r[0])
  if (!list) return null

  // Fetch raw, sort in JS — keeps the comparator shared with the
  // optimistic re-sort in TodoListEditor. Order is "unchecked first →
  // sortOrder → createdAt" (per-item priority/favorite were retired).
  const rawItems = await db
    .select()
    .from(todoItems)
    .where(eq(todoItems.listId, list.id))

  const items = rawItems
    .map((i) => ({
      id: i.id,
      text: i.text,
      isChecked: i.isChecked,
      sortOrder: i.sortOrder,
      createdAt: i.createdAt,
    }))
    .sort(compareTodoItems)

  return {
    id: list.id,
    title: list.title,
    items: items.map(({ createdAt: _c, ...rest }) => rest),
  }
}


// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createTodoList(title?: string): Promise<{ id: string }> {
  const user = await requireUser()
  const [row] = await db
    .insert(todoLists)
    .values({
      userId: user.id,
      title: title?.trim() || defaultTitle(),
    })
    .returning({ id: todoLists.id })
  revalidatePath('/todos')
  return { id: row.id }
}

export async function renameTodoList(listId: string, title: string) {
  const user = await requireUser()
  const clean = title.trim()
  if (!clean) return { error: 'Title cannot be empty.' }
  await db
    .update(todoLists)
    .set({ title: clean, updatedAt: new Date() })
    .where(and(eq(todoLists.id, listId), eq(todoLists.userId, user.id)))
  revalidatePath('/todos')
  revalidatePath(`/todos/${listId}`)
  return { success: true }
}

export async function deleteTodoList(listId: string) {
  const user = await requireUser()
  await db
    .delete(todoLists)
    .where(and(eq(todoLists.id, listId), eq(todoLists.userId, user.id)))
  revalidatePath('/todos')
  return { success: true }
}

async function assertOwnsList(userId: string, listId: string) {
  const owned = await db
    .select({ id: todoLists.id })
    .from(todoLists)
    .where(and(eq(todoLists.id, listId), eq(todoLists.userId, userId)))
    .then((r) => r[0])
  if (!owned) throw new Error('List not found')
}

export async function addTodoItem(listId: string, text: string): Promise<{ id: string }> {
  const user = await requireUser()
  await assertOwnsList(user.id, listId)

  // Append at the end: highest existing sortOrder + 1.
  const last = await db
    .select({ sortOrder: todoItems.sortOrder })
    .from(todoItems)
    .where(eq(todoItems.listId, listId))
    .orderBy(desc(todoItems.sortOrder))
    .limit(1)
    .then((r) => r[0])

  const nextOrder = (last?.sortOrder ?? -1) + 1
  const [row] = await db
    .insert(todoItems)
    .values({ listId, text: text.trim(), sortOrder: nextOrder })
    .returning({ id: todoItems.id })

  await db
    .update(todoLists)
    .set({ updatedAt: new Date() })
    .where(eq(todoLists.id, listId))

  revalidatePath('/todos')
  revalidatePath(`/todos/${listId}`)
  return { id: row.id }
}

export async function updateTodoItem(itemId: string, text: string) {
  const user = await requireUser()
  // Verify ownership via the parent list — single join.
  const row = await db
    .select({ listId: todoItems.listId, ownerId: todoLists.userId })
    .from(todoItems)
    .innerJoin(todoLists, eq(todoLists.id, todoItems.listId))
    .where(eq(todoItems.id, itemId))
    .then((r) => r[0])
  if (!row || row.ownerId !== user.id) throw new Error('Item not found')

  await db.update(todoItems).set({ text: text.trim() }).where(eq(todoItems.id, itemId))
  await db
    .update(todoLists)
    .set({ updatedAt: new Date() })
    .where(eq(todoLists.id, row.listId))
  revalidatePath(`/todos/${row.listId}`)
  return { success: true }
}

export async function toggleTodoItem(itemId: string, isChecked: boolean) {
  const user = await requireUser()
  const row = await db
    .select({ listId: todoItems.listId, ownerId: todoLists.userId })
    .from(todoItems)
    .innerJoin(todoLists, eq(todoLists.id, todoItems.listId))
    .where(eq(todoItems.id, itemId))
    .then((r) => r[0])
  if (!row || row.ownerId !== user.id) throw new Error('Item not found')

  await db.update(todoItems).set({ isChecked }).where(eq(todoItems.id, itemId))
  await db
    .update(todoLists)
    .set({ updatedAt: new Date() })
    .where(eq(todoLists.id, row.listId))
  revalidatePath('/todos')
  revalidatePath(`/todos/${row.listId}`)
  return { success: true }
}

// Per-LIST flag setters — flag a whole list on the /todos index card so
// it floats to the top of the index. Replaces the earlier per-item
// flags (those were too noisy at the row level). The is_favorite and
// is_priority columns on todo_item still exist but are no longer read
// or written by the app.

export async function setTodoListFavorite(listId: string, isFavorite: boolean) {
  const user = await requireUser()
  await assertOwnsList(user.id, listId)
  await db
    .update(todoLists)
    .set({ isFavorite })
    .where(eq(todoLists.id, listId))
  revalidatePath('/todos')
  revalidatePath(`/todos/${listId}`)
  return { success: true }
}

export async function setTodoListPriority(listId: string, isPriority: boolean) {
  const user = await requireUser()
  await assertOwnsList(user.id, listId)
  await db
    .update(todoLists)
    .set({ isPriority })
    .where(eq(todoLists.id, listId))
  revalidatePath('/todos')
  revalidatePath(`/todos/${listId}`)
  return { success: true }
}

export async function deleteTodoItem(itemId: string) {
  const user = await requireUser()
  const row = await db
    .select({ listId: todoItems.listId, ownerId: todoLists.userId })
    .from(todoItems)
    .innerJoin(todoLists, eq(todoLists.id, todoItems.listId))
    .where(eq(todoItems.id, itemId))
    .then((r) => r[0])
  if (!row || row.ownerId !== user.id) throw new Error('Item not found')

  await db.delete(todoItems).where(eq(todoItems.id, itemId))
  revalidatePath('/todos')
  revalidatePath(`/todos/${row.listId}`)
  return { success: true }
}

export async function deleteCheckedTodoItems(listId: string) {
  const user = await requireUser()
  await assertOwnsList(user.id, listId)
  await db
    .delete(todoItems)
    .where(and(eq(todoItems.listId, listId), eq(todoItems.isChecked, true)))
  await db
    .update(todoLists)
    .set({ updatedAt: new Date() })
    .where(eq(todoLists.id, listId))
  revalidatePath('/todos')
  revalidatePath(`/todos/${listId}`)
  return { success: true }
}

// ─── Reminders attached to this list ─────────────────────────────────────────
// Pending reminders show as a small badge on the list view. Cancellation
// + creation use the reminder actions in lib/actions/reminders.ts —
// nothing list-specific to do here beyond surfacing the rows.

export async function listTodoReminders(listId: string) {
  const user = await requireUser()
  await assertOwnsList(user.id, listId)
  const rows = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), eq(reminders.todoListId, listId)))
    .orderBy(asc(reminders.remindAt))
  return rows
}
