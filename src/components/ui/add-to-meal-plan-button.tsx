'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ListChecks } from 'lucide-react'
import { addRecipeToPlan } from '@/lib/actions/meal-plan'

/** Small button on the recipe note detail page that adds the recipe to the
 *  current user's meal plan. After click, briefly flips to a confirmation
 *  state, then settles back. Doesn't navigate; meal-plan page picks up the
 *  new pick on next visit. */
export function AddToMealPlanButton({ recipeId }: { recipeId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function add() {
    setDone(false)
    startTransition(async () => {
      const res = await addRecipeToPlan(recipeId, 1)
      if (!('error' in res) || !res.error) {
        setDone(true)
        setTimeout(() => setDone(false), 2000)
        router.refresh()
      }
    })
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={isPending}
      // Soft theme-aware pill — matches the Back-to-plan style on the
      // grocery page and the recipe-card pills, so every "soft button"
      // in the recipe area reads the same. text-stone-100 swap on
      // hover gives a clear feedback beat.
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap disabled:opacity-60 transition"
      style={{
        backgroundColor: 'rgb(var(--accent-700) / 0.18)',
        color: 'rgb(var(--accent-200))',
        boxShadow:
          '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 10px rgb(var(--accent-500) / 0.2)',
      }}
    >
      {done ? (
        <>
          <Check size={13} />
          Added!
        </>
      ) : (
        <>
          <ListChecks size={13} />
          Add to meal plan
        </>
      )}
    </button>
  )
}
