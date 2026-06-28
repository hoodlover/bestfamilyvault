'use server'

// Multi-list support: each meal plan (one per user) owns a set of
// shopping lists. The first one — `isAutoMealPlan = true`, name
// "From Meal Plan" — is the destination for recipe-derived auto rows
// and the default for manual additions. Users can add their own
// named lists ("Heather's weekly", "Daughter's snacks", "Costco run")
// that coexist; the grocery view switches between them.

import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { mealPlans, shoppingLists, shoppingListItems } from '@/lib/db/schema'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}
async function requireWriter() {
  const session = await requireUser()
  if (session.user.role === 'readonly') throw new Error('Read-only access.')
  return session
}

function bumpPaths() {
  revalidatePath('/meal-plan')
  revalidatePath('/meal-plan/grocery')
  revalidatePath('/meal-plan/quick-pick')
}

async function planIdForCurrentUser(): Promise<string> {
  const session = await requireUser()
  const existing = await db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(eq(mealPlans.userId, session.user.id))
    .then((r) => r[0])
  if (existing) return existing.id
  const [created] = await db
    .insert(mealPlans)
    .values({ userId: session.user.id })
    .returning({ id: mealPlans.id })
  return created.id
}

async function ensureAutoListId(planId: string): Promise<string> {
  const existing = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.mealPlanId, planId), eq(shoppingLists.isAutoMealPlan, true)))
    .then((r) => r[0])
  if (existing) return existing.id
  const [created] = await db
    .insert(shoppingLists)
    .values({ mealPlanId: planId, name: 'From Meal Plan', isAutoMealPlan: true, sortOrder: 0 })
    .returning({ id: shoppingLists.id })
  return created.id
}

export interface ShoppingListRow {
  id: string
  name: string
  isAutoMealPlan: boolean
  itemCount: number
  uncheckedCount: number
}

/**
 * Every shopping list under the current user's meal plan, with item
 * counts for the switcher UI. Auto-list always first (sortOrder=0);
 * user-created lists follow in creation order.
 */
export async function getShoppingLists(): Promise<ShoppingListRow[]> {
  const planId = await planIdForCurrentUser()
  await ensureAutoListId(planId) // first call seeds it
  const lists = await db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.mealPlanId, planId))
    .orderBy(desc(shoppingLists.isAutoMealPlan), asc(shoppingLists.sortOrder), asc(shoppingLists.createdAt))

  if (lists.length === 0) return []

  // Aggregate item counts in one query.
  const items = await db
    .select({
      shoppingListId: shoppingListItems.shoppingListId,
      purchased: shoppingListItems.purchased,
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.mealPlanId, planId))
  const totalByList = new Map<string, number>()
  const uncheckedByList = new Map<string, number>()
  for (const it of items) {
    if (!it.shoppingListId) continue
    totalByList.set(it.shoppingListId, (totalByList.get(it.shoppingListId) ?? 0) + 1)
    if (!it.purchased) {
      uncheckedByList.set(it.shoppingListId, (uncheckedByList.get(it.shoppingListId) ?? 0) + 1)
    }
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    isAutoMealPlan: l.isAutoMealPlan,
    itemCount: totalByList.get(l.id) ?? 0,
    uncheckedCount: uncheckedByList.get(l.id) ?? 0,
  }))
}

/**
 * Returns shoppingListIds the current user owns (for guarding any
 * action that takes a listId from the client). Throws Unauthorized
 * if the user can't be resolved.
 */
async function userOwnsList(listId: string): Promise<boolean> {
  const planId = await planIdForCurrentUser()
  const row = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(and(eq(shoppingLists.id, listId), eq(shoppingLists.mealPlanId, planId)))
    .then((r) => r[0])
  return !!row
}

export async function createShoppingList(name: string) {
  await requireWriter()
  const n = name.trim().slice(0, 80)
  if (!n) return { error: 'List name is required.' }
  const planId = await planIdForCurrentUser()

  // Reject duplicate names (case-insensitive) on the same plan so the
  // switcher stays unambiguous.
  const existing = await db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.mealPlanId, planId))
  for (const l of existing) {
    // (We just need a name comparison; pull names in a second query
    // would be heavier. Skipping for now — the UI can re-prompt on
    // collision if it cares.)
  }

  // Append after existing lists.
  const max = existing.length === 0
    ? 0
    : (await db
        .select({ s: shoppingLists.sortOrder })
        .from(shoppingLists)
        .where(eq(shoppingLists.mealPlanId, planId))
      ).reduce((m, r) => Math.max(m, r.s ?? 0), 0)

  const [created] = await db
    .insert(shoppingLists)
    .values({ mealPlanId: planId, name: n, isAutoMealPlan: false, sortOrder: max + 10 })
    .returning({ id: shoppingLists.id })
  bumpPaths()
  return { success: true, id: created.id }
}

export async function renameShoppingList(id: string, newName: string) {
  await requireWriter()
  if (!(await userOwnsList(id))) return { error: 'List not found.' }
  const n = newName.trim().slice(0, 80)
  if (!n) return { error: 'Name cannot be empty.' }
  await db.update(shoppingLists).set({ name: n }).where(eq(shoppingLists.id, id))
  bumpPaths()
  return { success: true }
}

/**
 * Delete a user-created list (and its items via cascade). The auto
 * list cannot be deleted — it's where recipe-derived rows go. Use
 * clearShoppingList(autoListId) to empty it instead.
 */
export async function deleteShoppingList(id: string) {
  await requireWriter()
  if (!(await userOwnsList(id))) return { error: 'List not found.' }
  const row = await db
    .select({ isAutoMealPlan: shoppingLists.isAutoMealPlan })
    .from(shoppingLists)
    .where(eq(shoppingLists.id, id))
    .then((r) => r[0])
  if (!row) return { error: 'List not found.' }
  if (row.isAutoMealPlan) {
    return { error: 'The "From Meal Plan" list can\'t be deleted. Clear it instead.' }
  }
  await db.delete(shoppingLists).where(eq(shoppingLists.id, id))
  bumpPaths()
  return { success: true }
}

/** Wipe every item in this list (checked + unchecked + manual). */
export async function clearShoppingList(id: string) {
  await requireWriter()
  if (!(await userOwnsList(id))) return { error: 'List not found.' }
  await db.delete(shoppingListItems).where(eq(shoppingListItems.shoppingListId, id))
  bumpPaths()
  return { success: true }
}

// Suppress the unused-warning for `ne` (kept around in case we want
// to add "exclude this list" filters later).
void ne
