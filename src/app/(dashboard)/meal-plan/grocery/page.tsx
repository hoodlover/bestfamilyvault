import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getMealPlan, getShoppingListItems } from '@/lib/actions/meal-plan'
import { getShoppingLists } from '@/lib/actions/shopping-lists'
import { GroceryList } from '@/components/ui/grocery-list'
import { ListSwitcher } from '@/components/ui/list-switcher'
import { MealPlanTabs } from '@/components/ui/meal-plan-tabs'

interface Props {
  searchParams: Promise<{ list?: string }>
}

export default async function GroceryPage({ searchParams }: Props) {
  const { list: requestedListId } = await searchParams
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  // Fetch lists for the switcher; default to the auto-list when no
  // explicit ?list= is given.
  const lists = await getShoppingLists()
  const autoList = lists.find((l) => l.isAutoMealPlan)
  const activeListId = lists.find((l) => l.id === requestedListId)?.id ?? autoList?.id
  if (!activeListId) {
    // Shouldn't happen — ensureAutoListId in getShoppingLists creates
    // one — but if it does, send the user back to the meal plan.
    redirect('/meal-plan')
  }
  const activeList = lists.find((l) => l.id === activeListId)!

  const items = await getShoppingListItems(activeListId) ?? []

  // Recipe-id → title lookup for the per-row "for X, Y" label —
  // only meaningful for the auto-list (other lists have no recipe context).
  const plan = await getMealPlan()
  const titleByRecipe = Object.fromEntries(plan.recipes.map((r) => [r.recipeId, r.title]))

  // Only ticked auto-rows belong on the shopping trip; manual rows are
  // always on the list (their `selected` is set true server-side). The
  // tick state lives in the parent meal plan keyed by itemKey so it
  // survives recipe rescales. User-created lists never need ticking.
  const visibleItems = items.filter((i) => i.selected)

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-32">
      {/* Order: area-nav menu first, then the "which list?" switcher,
          then the list itself. Matches the rhythm on /recipes,
          /meal-plan, and /meal-plan/quick-pick where the tab row is
          the very first thing on the screen. */}
      <MealPlanTabs active="grocery" />
      <ListSwitcher lists={lists} activeListId={activeListId} activeListName={activeList.name} activeIsAuto={activeList.isAutoMealPlan} />
      <GroceryList
        items={visibleItems}
        titleByRecipe={titleByRecipe}
        activeListId={activeListId}
      />
    </div>
  )
}
