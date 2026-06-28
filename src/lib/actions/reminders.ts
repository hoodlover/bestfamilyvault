'use server'

// User-scheduled reminders — server actions. Reminders are delivered by
// the /api/cron/process-reminders cron which scans for due rows and
// fires sendPushToUser per row. These actions are for the UI to create /
// cancel reminders the user explicitly sets.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, reminders, todoLists } from '@/lib/db/schema'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role === 'readonly') throw new Error('Read-only access.')
  return session.user
}

interface CreateReminderInput {
  title: string
  body?: string | null
  remindAt: Date | string  // ISO string from datetime-local input is fine
  noteId?: string | null
  todoListId?: string | null
}

export async function createReminder(input: CreateReminderInput) {
  const user = await requireUser()

  const remindAt = typeof input.remindAt === 'string' ? new Date(input.remindAt) : input.remindAt
  if (!(remindAt instanceof Date) || isNaN(remindAt.getTime())) {
    return { error: 'Invalid date.' }
  }
  if (remindAt.getTime() <= Date.now()) {
    return { error: 'Pick a time in the future.' }
  }
  const title = input.title.trim()
  if (!title) return { error: 'Title is required.' }

  // Verify the linked parent (note / todo list) belongs to this user so a
  // request can't attach a reminder to someone else's row.
  if (input.noteId) {
    const owned = await db
      .select({ id: notes.id, isPersonal: notes.isPersonal, createdBy: notes.createdBy })
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .then((r) => r[0])
    if (!owned) return { error: 'Note not found.' }
    if (owned.isPersonal && owned.createdBy !== user.id) return { error: 'Not yours.' }
  }
  if (input.todoListId) {
    const owned = await db
      .select({ id: todoLists.id })
      .from(todoLists)
      .where(and(eq(todoLists.id, input.todoListId), eq(todoLists.userId, user.id)))
      .then((r) => r[0])
    if (!owned) return { error: 'Todo list not found.' }
  }

  const [row] = await db
    .insert(reminders)
    .values({
      userId: user.id,
      title,
      body: input.body?.trim() || null,
      noteId: input.noteId ?? null,
      todoListId: input.todoListId ?? null,
      remindAt,
    })
    .returning({ id: reminders.id })

  if (input.noteId) revalidatePath(`/notes/${input.noteId}`)
  if (input.todoListId) revalidatePath(`/todos/${input.todoListId}`)
  revalidatePath('/reminders')
  return { success: true as const, id: row.id }
}

export async function cancelReminder(reminderId: string) {
  const user = await requireUser()
  const row = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, user.id)))
    .then((r) => r[0])
  if (!row) return { error: 'Reminder not found.' }
  await db.delete(reminders).where(eq(reminders.id, reminderId))
  if (row.noteId) revalidatePath(`/notes/${row.noteId}`)
  if (row.todoListId) revalidatePath(`/todos/${row.todoListId}`)
  revalidatePath('/reminders')
  return { success: true }
}

export async function listMyPendingReminders() {
  const user = await requireUser()
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), isNull(reminders.sentAt)))
    .orderBy(asc(reminders.remindAt))
}

export async function listRemindersForNote(noteId: string) {
  const user = await requireUser()
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), eq(reminders.noteId, noteId)))
    .orderBy(asc(reminders.remindAt))
}

export async function listRemindersForTodoList(listId: string) {
  const user = await requireUser()
  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, user.id), eq(reminders.todoListId, listId)))
    .orderBy(asc(reminders.remindAt))
}
