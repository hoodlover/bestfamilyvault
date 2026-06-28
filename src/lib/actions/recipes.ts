'use server'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, notes, subcategories } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'

async function getSession() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

const RECIPES_SLUG = 'recipes'
const RECIPES_NAME = 'Recipes'

// Canonical recipe subcategories. Seeded under the Recipes category on
// first run so the New Recipe form's checkbox grid (and the
// /categories/recipes filter chips) always have the same set. Order
// here is the order they render in. `icon` paths are from
// public/icons/recipe-icons — missing entries fall back to the
// regex-based subcategoryIconRules then to the parent category icon.
// `children` adds one level of nesting (e.g. Holidays → Christmas).
interface SubcatSeed {
  name: string
  slug: string
  icon: string | null
  children?: SubcatSeed[]
}
const RECIPE_SUBCATEGORIES: SubcatSeed[] = [
  { name: 'Slow Cooker', slug: 'slow-cooker', icon: null },
  { name: 'Poultry',     slug: 'poultry',     icon: '/icons/recipe-icons/chicken.png' },
  { name: 'Seafood',     slug: 'seafood',     icon: '/icons/recipe-icons/seafood.png' },
  { name: 'Desserts',    slug: 'desserts',    icon: '/icons/recipe-icons/desserts.png' },
  { name: 'Salads',      slug: 'salads',      icon: '/icons/recipe-icons/salads.png' },
  { name: 'Sides',       slug: 'sides',       icon: '/icons/recipe-icons/sides.png' },
  { name: 'Soups',       slug: 'soups',       icon: '/icons/recipe-icons/soups.png' },
  { name: 'Breads',      slug: 'breads',      icon: '/icons/recipe-icons/breads.png' },
  { name: 'Appetizers',  slug: 'appetizers',  icon: '/icons/recipe-icons/appetizers.png' },
  { name: 'Vegetarian',  slug: 'vegetarian',  icon: '/icons/recipe-icons/vegetarian.png' },
  { name: 'Pasta',       slug: 'pasta',       icon: '/icons/recipe-icons/pasta.png' },
  { name: 'Meat',        slug: 'meat',        icon: null },
  { name: 'Veggies',     slug: 'veggies',     icon: '/icons/recipe-icons/veggies.png' },
  { name: 'Cookies',     slug: 'cookies',     icon: '/icons/recipe-icons/cookies.png' },
  {
    name: 'Holidays', slug: 'holidays', icon: '/icons/recipe-icons/holidays.png',
    children: [
      { name: 'Christmas',    slug: 'christmas',    icon: '/icons/recipe-icons/christmas.png' },
      { name: 'Easter',       slug: 'easter',       icon: '/icons/recipe-icons/easter.png' },
      { name: 'Thanksgiving', slug: 'thanksgiving', icon: '/icons/recipe-icons/thanksgiving.png' },
    ],
  },
]

/**
 * Seed any of the canonical recipe subcategories that are missing under
 * the given Recipes category. Idempotent — checks by (categoryId, slug)
 * before inserting. Safe to call on every form render.
 */
async function seedRecipeSubcategories(recipesCategoryId: string): Promise<void> {
  // Two passes: parents first (so we have their IDs), then children
  // referencing those parent IDs via parentSubcategoryId.
  const existing = await db
    .select({ id: subcategories.id, slug: subcategories.slug })
    .from(subcategories)
    .where(eq(subcategories.categoryId, recipesCategoryId))
  const idBySlug = new Map(existing.map((r) => [r.slug, r.id]))
  const haveSlug = new Set(existing.map((r) => r.slug))

  // Pass 1 — top-level seeds.
  const parentInserts = RECIPE_SUBCATEGORIES
    .map((row, i) => ({ ...row, sortOrder: (i + 1) * 10 }))
    .filter((row) => !haveSlug.has(row.slug))
  if (parentInserts.length > 0) {
    const inserted = await db
      .insert(subcategories)
      .values(parentInserts.map((row) => ({
        categoryId: recipesCategoryId,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        sortOrder: row.sortOrder,
      })))
      .returning({ id: subcategories.id, slug: subcategories.slug })
    for (const r of inserted) idBySlug.set(r.slug, r.id)
  }

  // Pass 2 — children that reference their parent's id. Same
  // missing-only filter so re-running is safe.
  const childInserts: Array<{
    categoryId: string
    parentSubcategoryId: string
    name: string
    slug: string
    icon: string | null
    sortOrder: number
  }> = []
  for (const parent of RECIPE_SUBCATEGORIES) {
    if (!parent.children) continue
    const parentId = idBySlug.get(parent.slug)
    if (!parentId) continue
    parent.children.forEach((child, j) => {
      if (haveSlug.has(child.slug)) return
      childInserts.push({
        categoryId: recipesCategoryId,
        parentSubcategoryId: parentId,
        name: child.name,
        slug: child.slug,
        icon: child.icon,
        sortOrder: (j + 1) * 10,
      })
    })
  }
  if (childInserts.length > 0) {
    await db.insert(subcategories).values(childInserts)
  }
}

/** Returns the Recipes category, creating it if it doesn't exist. */
export async function ensureRecipesCategory(): Promise<{ id: string; name: string } | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const existing = await db.select().from(categories).where(eq(categories.slug, RECIPES_SLUG)).then((r) => r[0])
  if (existing) {
    // Category exists — make sure the canonical subcategory set is seeded
    // (catches users who created Recipes manually before this list existed).
    await seedRecipeSubcategories(existing.id)
    return { id: existing.id, name: existing.name }
  }

  // Only superusers can create categories — for everyone else, return null
  // and the form will let them pick any category. The next time a superuser
  // hits the form, the category gets seeded.
  if (session.user.role !== 'superuser') return null

  // Find the highest sortOrder so we can append.
  const all = await db.select({ sortOrder: categories.sortOrder }).from(categories)
  const maxSort = all.reduce((m, c) => Math.max(m, c.sortOrder), 0)

  const [created] = await db.insert(categories).values({
    name: RECIPES_NAME,
    slug: RECIPES_SLUG,
    icon: null,
    description: 'Family recipes — handed down, written down, kept around.',
    sortOrder: maxSort + 10,
    isDefault: false,
  }).returning()
  await seedRecipeSubcategories(created.id)
  revalidatePath('/admin')
  revalidatePath('/dashboard')
  return { id: created.id, name: created.name }
}

/**
 * Returns the subcategories of the Recipes category, in sortOrder.
 * Includes parentSubcategoryId so UIs can render the parent/child
 * tree (e.g. Holidays → Christmas / Easter / Thanksgiving).
 * Empty array if the Recipes category hasn't been created yet (or
 * the user isn't logged in).
 */
export async function getRecipeSubcategories(): Promise<{
  id: string
  name: string
  slug: string
  parentSubcategoryId: string | null
}[]> {
  const session = await auth()
  if (!session?.user?.id) return []
  const cat = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, RECIPES_SLUG))
    .then((r) => r[0])
  if (!cat) return []
  const subs = await db
    .select({
      id: subcategories.id,
      name: subcategories.name,
      slug: subcategories.slug,
      parentSubcategoryId: subcategories.parentSubcategoryId,
    })
    .from(subcategories)
    .where(eq(subcategories.categoryId, cat.id))
    .orderBy(asc(subcategories.sortOrder))
  return subs
}

interface CreateRecipeResult {
  success?: true
  id?: string
  error?: string
}

export async function createRecipe(formData: FormData): Promise<CreateRecipeResult> {
  const session = await getSession()
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  const title = (formData.get('title') as string ?? '').trim()
  const categoryId = (formData.get('categoryId') as string ?? '').trim()
  const ingredients = (formData.get('ingredients') as string ?? '').trim()
  const method = (formData.get('method') as string ?? '').trim()
  const story = (formData.get('story') as string ?? '').trim()
  // Servings — null when blank or unparseable so the column stays clean.
  const servingsRaw = (formData.get('servings') as string ?? '').trim()
  const servingsNum = servingsRaw === '' ? null : Number(servingsRaw)
  const servings = servingsNum != null && Number.isFinite(servingsNum) && servingsNum > 0
    ? Math.round(servingsNum)
    : null

  if (!title) return { error: 'Title is required.' }
  if (!categoryId) return { error: 'Category is required.' }

  // Validate the category exists.
  const cat = await db.select().from(categories).where(eq(categories.id, categoryId)).then((r) => r[0])
  if (!cat) return { error: 'Category not found.' }

  // Recipe subcategory tags. Multiple selections come in as repeated
  // `tags` form fields (subcategory IDs). We resolve them to their
  // canonical names for storage in notes.tags[] and set the note's
  // primary subcategoryId to the first match so the existing single-
  // subcategory filter on /categories/[slug] still picks it up.
  const rawTagIds = formData.getAll('tags').map((v) => String(v).trim()).filter(Boolean)
  let tagNames: string[] = []
  let primarySubcategoryId: string | null = null
  if (rawTagIds.length > 0) {
    const subs = await db
      .select({ id: subcategories.id, name: subcategories.name, sortOrder: subcategories.sortOrder })
      .from(subcategories)
      .where(and(eq(subcategories.categoryId, cat.id), inArray(subcategories.id, rawTagIds)))
    // Keep the user's selection order so the first checked box becomes
    // the primary subcategory.
    const byId = new Map(subs.map((s) => [s.id, s]))
    const ordered = rawTagIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)
    tagNames = ordered.map((s) => s.name)
    primarySubcategoryId = ordered[0]?.id ?? null
  }

  // Render the recipe as plaintext-with-headings inside the note's content.
  // The detail page already renders notes verbatim, and a markdown-renderer
  // upgrade later will pick these section headings up automatically.
  const sections: string[] = []
  if (ingredients) {
    const lines = ingredients.split('\n').map((l) => l.trim()).filter(Boolean)
    sections.push('## Ingredients\n' + lines.map((l) => `- ${l}`).join('\n'))
  }
  if (method) sections.push('## Method\n' + method.trim())
  if (story) sections.push('## Story\n' + story.trim())

  const content = sections.join('\n\n')
  const encrypted = content === '' ? '' : (encrypt(content) ?? '')

  const [created] = await db.insert(notes).values({
    categoryId,
    subcategoryId: primarySubcategoryId,
    title,
    content: encrypted,
    tags: tagNames.length > 0 ? tagNames : null,
    servings,
    isPrivate: false,
    isPersonal: false,
    isFavorite: false,
    createdBy: session.user.id,
    updatedBy: session.user.id,
  }).returning()

  revalidatePath('/notes')
  revalidatePath('/dashboard')
  if (cat.slug) revalidatePath(`/categories/${cat.slug}`)
  return { success: true, id: created.id }
}
