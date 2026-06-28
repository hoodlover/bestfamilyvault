import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { decryptNotes } from '@/lib/crypto'
import { getMealPlan } from '@/lib/actions/meal-plan'
import { MealPlanBuilder } from '@/components/ui/meal-plan-builder'

export default async function MealPlanPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const userId = session.user.id

  // Pull every recipe the user can see — anything in the recipes category
  // (per slug) that's not someone else's personal note. Decrypt up front so
  // ingredient parsing works on the client lookups.
  const recipesCategory = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, 'recipes'))
    .then((r) => r[0])

  const recipesRaw = recipesCategory
    ? await db
        .select({
          id: notes.id,
          title: notes.title,
          servings: notes.servings,
          updatedAt: notes.updatedAt,
        })
        .from(notes)
        .where(
          and(
            eq(notes.categoryId, recipesCategory.id),
            or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
          ),
        )
        .orderBy(notes.title)
    : []
  // The recipe lookup doesn't need content — we already cached it server-side
  // when the plan was last regenerated.
  const recipes = recipesRaw

  const plan = await getMealPlan()

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-32">
      <MealPlanBuilder
        initialRecipes={recipes}
        initialPlan={plan}
      />
    </div>
  )
}
