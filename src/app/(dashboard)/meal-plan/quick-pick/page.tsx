import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { QuickPick } from '@/components/ui/quick-pick'
import { MealPlanTabs } from '@/components/ui/meal-plan-tabs'
import { ensureQuickPickSeeded, getQuickPickItems } from '@/lib/actions/quick-pick'
import { getShoppingLists } from '@/lib/actions/shopping-lists'

interface Props {
  searchParams: Promise<{ list?: string }>
}

export default async function QuickPickPage({ searchParams }: Props) {
  const { list: requestedListId } = await searchParams
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/meal-plan')

  // Lazy seed on first visit — copies GROCERY_STAPLES into the DB so
  // the family has a starting list, then never touches the static
  // source again. Re-runs after seed are a cheap "is table empty?" check.
  await ensureQuickPickSeeded()
  const [items, lists] = await Promise.all([
    getQuickPickItems(),
    getShoppingLists(),
  ])

  // Default destination = ?list=<id> when present, else the auto-list.
  const autoList = lists.find((l) => l.isAutoMealPlan)
  const defaultListId = lists.find((l) => l.id === requestedListId)?.id ?? autoList?.id ?? lists[0]?.id ?? ''

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <MealPlanTabs active="quick" />
      <QuickPick
        initialItems={items}
        canEdit={session.user.role !== 'readonly'}
        lists={lists}
        defaultListId={defaultListId}
      />
    </div>
  )
}
