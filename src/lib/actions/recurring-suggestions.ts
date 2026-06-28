'use server'

// Server actions for the /subscriptions Suggested tab.
//
// approveRecurringSuggestion — materializes a real entries row with
//   isRecurring=true, inheriting amount + period + predicted next-renewal
//   from the suggestion (so Phase 2's reminder cron picks it up
//   automatically), and stamps llcSubcategoryId so the new entry stays
//   associated with the LLC the source account is tagged with.
//   Files the new entry under the source account's own category /
//   subcategory — the source account is the canonical "what is this
//   charge associated with" pointer.
//
// dismissRecurringSuggestion — marks the suggestion dismissed so the
//   weekly detection cron stops resurfacing it.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, recurringSuggestions } from '@/lib/db/schema'

export async function approveRecurringSuggestion(suggestionId: string): Promise<{ error?: string; success?: boolean }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  const userId = session.user.id

  const sug = await db
    .select()
    .from(recurringSuggestions)
    .where(
      and(
        eq(recurringSuggestions.id, suggestionId),
        eq(recurringSuggestions.userId, userId),
      ),
    )
    .limit(1)
    .then((r) => r[0])

  if (!sug) return { error: 'Suggestion not found.' }
  if (sug.status !== 'pending') return { error: 'Already actioned.' }

  // Inherit category/subcategory from the source account so the new
  // recurring entry lives in the same place that account lives.
  const source = await db
    .select({
      categoryId: entries.categoryId,
      subcategoryId: entries.subcategoryId,
      llcSubcategoryId: entries.llcSubcategoryId,
    })
    .from(entries)
    .where(eq(entries.id, sug.accountEntryId))
    .limit(1)
    .then((r) => r[0])

  if (!source) return { error: 'Source account no longer exists.' }

  const [newEntry] = await db
    .insert(entries)
    .values({
      categoryId: source.categoryId,
      subcategoryId: source.subcategoryId,
      // Prefer the live llc tag on the source over the cached one on
      // the suggestion — if Lance re-tagged the account between
      // detection and approval, honor the current state.
      llcSubcategoryId: source.llcSubcategoryId ?? sug.llcSubcategoryId,
      type: 'note',
      title: titleCaseSafe(sug.displayName),
      isFavorite: false,
      isRecurring: true,
      subscriptionAmountCents: sug.typicalAmountCents,
      subscriptionPeriod: sug.period,
      subscriptionStartedAt: sug.firstSeenAt,
      subscriptionRenewsAt: sug.predictedNextAt,
      isPrivate: false,
      isPersonal: false,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()

  await db
    .update(recurringSuggestions)
    .set({ status: 'approved', approvedEntryId: newEntry.id, updatedAt: new Date() })
    .where(eq(recurringSuggestions.id, suggestionId))

  revalidatePath('/subscriptions')
  revalidatePath('/dashboard')
  return { success: true }
}

export async function dismissRecurringSuggestion(suggestionId: string): Promise<{ error?: string; success?: boolean }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  const userId = session.user.id

  const sug = await db
    .select({ status: recurringSuggestions.status })
    .from(recurringSuggestions)
    .where(
      and(
        eq(recurringSuggestions.id, suggestionId),
        eq(recurringSuggestions.userId, userId),
      ),
    )
    .limit(1)
    .then((r) => r[0])

  if (!sug) return { error: 'Suggestion not found.' }
  if (sug.status === 'dismissed') return { success: true }

  await db
    .update(recurringSuggestions)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(eq(recurringSuggestions.id, suggestionId))

  revalidatePath('/subscriptions')
  revalidatePath('/dashboard')
  return { success: true }
}

// Lowercase merchant strings from statements look ugly as entry titles.
// Title-case each word, but preserve known all-caps tokens (AWS, NYC).
function titleCaseSafe(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (w.length <= 4 && w === w.toUpperCase()) return w
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}
