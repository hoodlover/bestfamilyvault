import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { getMyTodoList } from '@/lib/actions/todos'
import { listRemindersForTodoList } from '@/lib/actions/reminders'
import { TodoListEditor } from '@/components/ui/todo-list-editor'
import { ReminderControl } from '@/components/ui/reminder-control'
import { ChevronLeft } from 'lucide-react'

export default async function TodoListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const list = await getMyTodoList(id)
  if (!list) notFound()

  const listReminders = await listRemindersForTodoList(id)

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-32">
      <Link
        href="/todos"
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-300 transition mb-4"
      >
        <ChevronLeft size={14} />
        Lists
      </Link>
      <TodoListEditor list={list} />
      <div className="mt-6">
        <ReminderControl
          todoListId={list.id}
          defaultTitle={list.title}
          initialReminders={listReminders.map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            remindAt: r.remindAt,
            sentAt: r.sentAt,
          }))}
        />
      </div>
    </div>
  )
}
