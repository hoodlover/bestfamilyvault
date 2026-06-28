import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { db } from '@/lib/db'
import { categories } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { RecipeForm } from '@/components/ui/recipe-form'
import { ensureRecipesCategory, getRecipeSubcategories } from '@/lib/actions/recipes'
import { LockEgg } from '@/components/ui/lock-egg'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function NewRecipePage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  // ensureRecipesCategory must finish before we read its subcategories,
  // since it also seeds the canonical set on first run.
  const recipesCat = await ensureRecipesCategory()
  const [allCats, recipeSubs] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.sortOrder)),
    getRecipeSubcategories(),
  ])

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link href="/dashboard" className="hover:text-stone-300 transition">Dashboard</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">New Recipe</span>
      </nav>

      <h1 className="flex items-center gap-3 text-2xl font-bold text-stone-100 mb-1">
        <LockEgg src="/icons/cobb/icons/Recipes/recipes.png" />
        New Recipe
        <HelpPopout
          title="New Recipe"
          sections={[
            {
              heading: 'Four ways to start',
              tips: [
                { title: 'Search', description: '"Import from the web" → Search tab. Claude finds 4.5+ star recipes on AllRecipes, NYT Cooking, Food Network, etc. Stars load inline.' },
                { title: 'Paste URL', description: '"Import from the web" → Paste URL tab. Most major recipe sites supported via JSON-LD.' },
                { title: 'Photo OCR', description: '"Scan a recipe…" → Take a photo or upload up to 3 pages. Claude reads ingredients + method.' },
                { title: 'Type it', description: 'Use the structured form below — amount + unit dropdowns + ingredient typeahead.' },
              ],
            },
            {
              heading: 'Ingredient adder',
              tips: [
                { title: 'Typeahead', description: 'Start typing — list filters by prefix. Grouped by Spices / Pantry / Fresh when empty.' },
                { title: 'Custom item', description: 'When no match exists, "Use \'{query}\' as custom" appears at the bottom.' },
                { title: 'Edit any line', description: 'Each saved ingredient is editable inline below the adder.' },
              ],
            },
            {
              heading: 'Recipe type',
              tips: [
                { title: 'Multi-select', description: 'Tick any subcategory (Slow Cooker, Soups, etc.). Holidays nests Christmas / Easter / Thanksgiving.' },
                { title: 'First pick = primary', description: 'The first ticked sub becomes notes.subcategoryId for navigation; all picks land in notes.tags[].' },
              ],
            },
            {
              heading: 'After save',
              tips: [
                { title: 'Add another?', description: 'Form clears (keeps category + measurement system), bottom card shows the saved recipe + "Add another" button — great for batch-entering cookbook recipes.' },
              ],
            },
          ]}
        />
      </h1>
      <p className="text-sm text-stone-400 mb-6">
        Pick measurements, click to add common spices and ingredients, edit anything that&rsquo;s not quite right.
      </p>

      <RecipeForm recipesCategory={recipesCat} allCategories={allCats} recipeSubcategories={recipeSubs} />
    </div>
  )
}
