import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { listMyTodoLists, createTodoList } from '@/lib/actions/todos'
import { TodoListRow } from '@/components/ui/todo-list-row'

export default async function TodosPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const lists = await listMyTodoLists()

  async function createAndOpen() {
    'use server'
    const { id } = await createTodoList()
    redirect(`/todos/${id}`)
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-32">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/to_do.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 object-contain shrink-0"
          />
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-stone-100">To Do</h1>
            <p className="text-sm text-stone-400 mt-0.5">
              {lists.length === 0 ? 'Start a list — title defaults to today.' : `${lists.length} list${lists.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        {/* Single icon-button: tap = create-with-default-title then jump
            into the editor, focus already on the first row. The to_do_add
            icon matches the addnote.png pattern on /notes (40px mobile /
            64px desktop) so the create-affordance reads the same. */}
        <form action={createAndOpen}>
          <button
            type="submit"
            aria-label="New list"
            title="New list"
            className="inline-block transition hover:opacity-90 active:opacity-80 shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/to_do_add.png"
              alt="New list"
              width={56}
              height={56}
              className="block h-14 w-14 object-contain"
            />
          </button>
        </form>
      </div>

      {lists.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">
          Tap{' '}
          <span className="text-amber-300">New list</span>
          {' '}to get started. Title defaults to today&apos;s date — edit it after.
        </p>
      ) : (
        <ul className="rounded-xl border border-stone-700/60 overflow-hidden bg-stone-900/40 divide-y divide-stone-800">
          {lists.map((l) => (
            <TodoListRow key={l.id} list={l} />
          ))}
        </ul>
      )}
    </div>
  )
}
