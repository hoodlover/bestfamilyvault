'use client'

// Meal-plan build screen. Two stacked sections:
//
//   1. Recipe picker — every recipe the user can see, with a checkbox to
//      add/remove from this week's plan and a 1/2/3/4× stepper. Search
//      filters by title (prefix match like the ingredient picker).
//
//   2. Shopping list preview — auto rows from the picked recipes + any
//      manual rows the user has typed in. Read-only here; the actionable
//      grocery view lives at /meal-plan/grocery.
//
// Mutations call server actions in @/lib/actions/meal-plan. Every action
// runs inside startTransition + router.refresh so the page server component
// re-pulls the updated plan on completion.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, ChevronUp, Minus, Plus, Search, X } from 'lucide-react'
import {
  addManualItem,
  addRecipeToPlan,
  clearMealPlan,
  removeRecipeFromPlan,
  removeShoppingItem,
  setRecipeScale,
  toggleItemSelected,
  type MealPlanData,
} from '@/lib/actions/meal-plan'
import { HelpPopout } from './help-popout'
import { MealPlanTabs } from './meal-plan-tabs'

interface RecipeRow {
  id: string
  title: string
  servings: number | null
  updatedAt: Date
}

interface Props {
  initialRecipes: RecipeRow[]
  initialPlan: MealPlanData
}

export function MealPlanBuilder({ initialRecipes, initialPlan }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [manualText, setManualText] = useState('')
  const [showAllRecipes, setShowAllRecipes] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const manualInputRef = useRef<HTMLInputElement>(null)

  // Server-confirmed picks (source of truth on every render).
  const serverPicks = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of initialPlan.recipes) m.set(r.recipeId, r.scale)
    return m
  }, [initialPlan.recipes])

  // Optimistic overlay: the user's latest pick + scale per recipe so a
  // single tap on the checkbox shows instantly (no perceived
  // "double-click required"). Cleared back to server state whenever
  // fresh props land.
  const [optimisticPicks, setOptimisticPicks] = useState<Map<string, number>>(serverPicks)
  useEffect(() => {
    setOptimisticPicks(new Map(serverPicks))
  }, [serverPicks])

  const pickedScaleMap = optimisticPicks

  // Stamp lastSavedAt on every successful refresh from the server. The
  // server actions revalidate /meal-plan, which re-renders this component
  // with fresh props; flag the time on prop change.
  useEffect(() => {
    setLastSavedAt(new Date())
  }, [initialPlan])

  function togglePick(recipeId: string) {
    const wasPicked = optimisticPicks.has(recipeId)
    setOptimisticPicks((prev) => {
      const next = new Map(prev)
      if (wasPicked) next.delete(recipeId)
      else next.set(recipeId, 1)
      return next
    })
    startTransition(async () => {
      if (wasPicked) await removeRecipeFromPlan(recipeId)
      else await addRecipeToPlan(recipeId, 1)
      router.refresh()
    })
  }

  // Half-step stepper. delta of -0.5 / +0.5 lets the user halve a
  // recipe instead of just doubling it. Clamped to [0.5, 10].
  function bumpScale(recipeId: string, delta: number) {
    const cur = optimisticPicks.get(recipeId) ?? 1
    const next = Math.round(Math.max(0.5, Math.min(10, cur + delta)) * 2) / 2
    if (next === cur) return
    setOptimisticPicks((prev) => new Map(prev).set(recipeId, next))
    startTransition(async () => { await setRecipeScale(recipeId, next); router.refresh() })
  }

  // Optimistic override map for checkbox state. Stores the value the
  // user just set (true/false) keyed by itemKey, NOT a "flip me" flag —
  // the previous Set-based version was buggy because it computed
  // `!serverSelected` at render time, so once router.refresh() landed
  // the new prop the override would invert AGAIN and the checkbox would
  // snap back for one frame. With explicit values, the displayed state
  // is always exactly what the user clicked; the override clears only
  // once the server-confirmed prop agrees with it (see useEffect below).
  const [pendingSelected, setPendingSelected] = useState<Map<string, boolean>>(new Map())
  function isSelected(itemKey: string | null, serverSelected: boolean) {
    if (!itemKey) return false
    const override = pendingSelected.get(itemKey)
    return override === undefined ? serverSelected : override
  }
  function flipSelected(itemKey: string | null, currentlyDisplayed: boolean) {
    if (!itemKey) return
    const nextVal = !currentlyDisplayed
    setPendingSelected((prev) => {
      const next = new Map(prev)
      next.set(itemKey, nextVal)
      return next
    })
    startTransition(async () => {
      await toggleItemSelected(itemKey)
      router.refresh()
    })
  }
  // Drop overrides whose server-confirmed value already matches — no
  // need to keep masking, and clearing here (not inline after refresh)
  // means there's no frame where the prop and override disagree.
  useEffect(() => {
    if (pendingSelected.size === 0) return
    let changed = false
    const next = new Map(pendingSelected)
    for (const item of initialPlan.shoppingList) {
      if (!item.itemKey) continue
      if (next.get(item.itemKey) === item.selected) {
        next.delete(item.itemKey)
        changed = true
      }
    }
    if (changed) setPendingSelected(next)
  }, [initialPlan.shoppingList, pendingSelected])

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const text = manualText.trim()
    if (!text) return
    startTransition(async () => {
      await addManualItem(text)
      setManualText('')
      router.refresh()
      manualInputRef.current?.focus()
    })
  }

  function removeItem(itemId: string) {
    startTransition(async () => { await removeShoppingItem(itemId); router.refresh() })
  }

  function clearAll() {
    if (!confirm('Clear the whole meal plan? All picked recipes and shopping list items go away.')) return
    startTransition(async () => { await clearMealPlan(); router.refresh() })
  }

  const q = query.trim().toLowerCase()
  const filteredRecipes = useMemo(() => {
    const all = initialRecipes
    if (q === '') return all
    // Prefix match on the title (matches the ingredient-picker UX).
    return all.filter((r) => r.title.toLowerCase().startsWith(q))
  }, [initialRecipes, q])

  const visibleRecipes = showAllRecipes || q !== '' ? filteredRecipes : filteredRecipes.slice(0, 8)

  const manualItems = initialPlan.shoppingList.filter((i) => i.isManual)
  const autoItems = initialPlan.shoppingList.filter((i) => !i.isManual)

  return (
    <div className="space-y-6">
      <MealPlanTabs active="plan" />
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/Recipes/meal_pla.png"
            alt=""
            width={48}
            height={48}
            className="block h-12 w-12 object-contain shrink-0 rounded-xl"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-stone-100">Meal plan</h1>
              <HelpPopout
                title="Meal plan"
                sections={[
                  {
                    heading: 'Pick recipes',
                    tips: [
                      { title: 'Tick the box', description: 'Adds the recipe to this week. Untick to remove.' },
                      { title: '±0.5 stepper', description: 'Scale a recipe in half-recipe increments (0.5–10×). Ingredient quantities scale in the shopping list.' },
                      { title: 'Search bar', description: 'Type a few letters to filter the recipe list by title.' },
                    ],
                  },
                  {
                    heading: 'Shopping list preview',
                    tips: [
                      { title: 'Auto items', description: 'Built from every picked recipe\'s ingredients — same units across recipes merge ("1 cup + 1 tbsp flour" → "1 cup 1 tbsp flour").' },
                      { title: 'Add anything', description: 'The "Add anything" box drops manual items in (paper towels, milk…).' },
                      { title: 'Tick to add', description: 'Auto items start unchecked — tick the box next to each ingredient you actually need to buy. Only ticked items show up in the Grocery view. Survives recipe rescales.' },
                      { title: 'Clear plan', description: 'Wipes recipes + the From-Meal-Plan list (other named lists are untouched).' },
                    ],
                  },
                  {
                    heading: 'Go to the store',
                    tips: [
                      { title: 'Grocery view →', description: 'Shop-mode list: items grouped by Publix aisle, big checkboxes, Print / PDF, switch between named lists.' },
                      { title: 'Quick-Pick', description: 'Tick from a full staples grid (16 categories) with per-trip specifics + write-ins. Targets any list.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              Pick the recipes for the week. Shopping list builds itself.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastSavedAt && (
            <span className="text-[11px] text-stone-500">
              {isPending ? 'Saving…' : `Auto-saved at ${formatTime(lastSavedAt)}`}
            </span>
          )}
          <Link
            href="/meal-plan/quick-pick"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-lg transition"
          >
            Quick-Pick
          </Link>
          <Link
            href="/meal-plan/grocery"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
          >
            Grocery view →
          </Link>
        </div>
      </div>

      {/* Recipe picker */}
      <section className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4">
        <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
          Recipes <span className="text-stone-600 normal-case font-normal">({initialPlan.recipes.length} picked)</span>
        </h2>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name…"
            className="w-full pl-8 pr-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          />
        </div>

        {visibleRecipes.length === 0 ? (
          <p className="text-sm text-stone-500 py-4 text-center">
            {q === '' ? 'No recipes yet. Add some from the Recipes page.' : 'No matches.'}
          </p>
        ) : (
          <ul className="divide-y divide-stone-800 rounded-lg border border-stone-800 overflow-hidden">
            {visibleRecipes.map((r) => {
              const picked = pickedScaleMap.has(r.id)
              const scale = pickedScaleMap.get(r.id) ?? 1
              return (
                <li
                  key={r.id}
                  className={`flex items-center gap-3 px-3 py-2.5 transition ${picked ? 'bg-emerald-950/20' : 'bg-stone-900/40'}`}
                >
                  <button
                    type="button"
                    onClick={() => togglePick(r.id)}
                    aria-label={picked ? 'Remove from meal plan' : 'Add to meal plan'}
                    className={`shrink-0 flex items-center justify-center h-6 w-6 rounded border transition ${
                      picked
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'border-stone-600 hover:border-emerald-500'
                    }`}
                  >
                    {picked && <Check size={14} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-200 truncate">{r.title}</div>
                    {r.servings != null && (
                      <div className="text-[11px] text-stone-500">Serves {r.servings}</div>
                    )}
                  </div>
                  {picked && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => bumpScale(r.id, -0.5)}
                        disabled={scale <= 0.5 || isPending}
                        aria-label="Decrease scale by 0.5"
                        className="inline-flex items-center justify-center h-7 w-7 rounded border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40 transition"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-sm font-mono text-emerald-300 min-w-12 text-center">×{formatScale(scale)}</span>
                      <button
                        type="button"
                        onClick={() => bumpScale(r.id, +0.5)}
                        disabled={scale >= 10 || isPending}
                        aria-label="Increase scale by 0.5"
                        className="inline-flex items-center justify-center h-7 w-7 rounded border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-300 disabled:opacity-40 transition"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {q === '' && filteredRecipes.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAllRecipes((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
          >
            {showAllRecipes ? (
              <><ChevronUp size={12} /> Show fewer</>
            ) : (
              <><ChevronDown size={12} /> Show all {filteredRecipes.length} recipes</>
            )}
          </button>
        )}
      </section>

      {/* Shopping list preview */}
      <section className="rounded-xl border border-stone-700/60 bg-stone-900/40 p-3 md:p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
            Shopping list <span className="text-stone-600 normal-case font-normal">({initialPlan.shoppingList.length})</span>
          </h2>
          {initialPlan.shoppingList.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-stone-500 hover:text-red-400 transition"
            >
              Clear plan
            </button>
          )}
        </div>

        {/* Manual add */}
        <form onSubmit={submitManual} className="flex items-center gap-2 mb-3">
          <input
            ref={manualInputRef}
            type="text"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Add anything (paper towels, milk…)"
            className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
          />
          <button
            type="submit"
            disabled={isPending || manualText.trim() === ''}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
          >
            <Plus size={14} />
            Add
          </button>
        </form>

        {initialPlan.shoppingList.length === 0 ? (
          <p className="text-sm text-stone-500 py-4 text-center">
            Pick a recipe above to start building the list.
          </p>
        ) : (
          <ul className="divide-y divide-stone-800 rounded-lg border border-stone-800 overflow-hidden">
            {manualItems.map((i) => (
              <ShoppingPreviewRow
                key={i.id}
                text={i.text}
                manual
                onRemove={() => removeItem(i.id)}
              />
            ))}
            {autoItems.map((i) => {
              const labels = i.recipeIds
                .map((rid) => initialPlan.recipes.find((p) => p.recipeId === rid)?.title)
                .filter((t): t is string => !!t)
              const displayed = isSelected(i.itemKey, i.selected)
              const itemKey = i.itemKey
              return (
                <ShoppingPreviewRow
                  key={i.id}
                  text={i.text}
                  manual={false}
                  selected={displayed}
                  onToggleSelected={itemKey ? () => flipSelected(itemKey, displayed) : undefined}
                  recipeLabel={labels.length > 0 ? labels.join(' · ') : undefined}
                />
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function ShoppingPreviewRow({
  text,
  manual,
  selected,
  recipeLabel,
  onRemove,
  onToggleSelected,
}: {
  text: string
  manual: boolean
  /** Auto-rows only: ticked = "yes, put this on the grocery list". Default false. */
  selected?: boolean
  recipeLabel?: string
  onRemove?: () => void
  onToggleSelected?: () => void
}) {
  // Auto-row: the checkbox on the LEFT is the only control. Tap-target
  // wraps the whole row so anywhere on the line (except the manual-only
  // X) toggles the tick.
  const isAuto = !manual
  const isTickable = isAuto && !!onToggleSelected

  const inner = (
    <>
      {/* Checkbox (auto-rows) OR plus badge (manual rows). Manual
          items don't have a tickable state — they're always on the
          list, they're literally "I typed this in". */}
      {isAuto ? (
        <span
          className={`inline-flex items-center justify-center h-5 w-5 rounded border shrink-0 transition ${
            selected ? 'text-white' : 'border-stone-600 bg-stone-900/40 hover:border-emerald-500'
          }`}
          // When selected, fill the box with the user's theme accent so
          // "this is going on the grocery list" lights up in color (the
          // page is otherwise mostly grey). Inline style + CSS vars so
          // the color stays correct regardless of cached CSS chunks.
          style={
            selected
              ? {
                  backgroundColor: 'rgb(var(--accent-500))',
                  borderColor: 'rgb(var(--accent-400))',
                  boxShadow: '0 0 8px rgb(var(--accent-300) / 0.35)',
                }
              : undefined
          }
          aria-hidden
        >
          {selected && <Check size={13} />}
        </span>
      ) : (
        <span className="inline-flex items-center justify-center h-5 w-5 rounded text-[10px] font-bold shrink-0 bg-amber-700/30 text-amber-300 border border-amber-700/50">
          +
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-stone-200 truncate">{text}</div>
        {recipeLabel && (
          <div className="text-[11px] text-stone-500 truncate">for {recipeLabel}</div>
        )}
      </div>
    </>
  )

  return (
    <li
      className="flex items-stretch gap-0 transition bg-stone-900/30"
      // When the auto-row is ticked, give the whole row a faint accent
      // wash so it visually pairs with the now-bright checkbox to the
      // left. Inline style for the same cache-bypass reason as the
      // checkbox above.
      style={
        isAuto && selected
          ? { backgroundColor: 'rgb(var(--accent-900) / 0.35)' }
          : undefined
      }
    >
      {isTickable ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelected!() }}
          aria-label={selected ? 'Remove from grocery list' : 'Add to grocery list'}
          className="flex flex-1 items-center gap-3 px-3 py-2 text-left min-w-0 cursor-pointer"
        >
          {inner}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-3 px-3 py-2 min-w-0">
          {inner}
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="px-2 text-stone-600 hover:text-red-400 transition shrink-0"
        >
          <X size={14} />
        </button>
      )}
    </li>
  )
}

function formatScale(s: number): string {
  // 0.5 → "1/2", 1 → "1", 1.5 → "1 1/2", 2 → "2", etc.
  const whole = Math.floor(s)
  const frac = s - whole
  if (frac < 0.01) return String(whole)
  if (Math.abs(frac - 0.5) < 0.01) {
    return whole === 0 ? '1/2' : `${whole} 1/2`
  }
  return s.toFixed(1)
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
