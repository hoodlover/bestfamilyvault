'use client'

// Shop-mode grocery list. Big checkboxes; tap to mark purchased. Items
// are grouped by Publix-aisle so you walk the store once instead of
// zig-zagging. Within each aisle, unpurchased items come first; checked
// items demote to the bottom of their aisle (and visually dim).
//
// Quick-add input at top so the user can append items on the fly while
// walking the aisles. Print button generates a clean printable view
// (just aisle headers + items with empty checkboxes).

import Link from 'next/link'
import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Printer, Trash2 } from 'lucide-react'
import {
  addManualItem,
  removeShoppingItem,
  toggleShoppingItemPurchased,
  type ShoppingListRow,
} from '@/lib/actions/meal-plan'
import { groupByAisle } from '@/lib/grocery-aisles'
import { HelpPopout } from './help-popout'

interface Props {
  items: ShoppingListRow[]
  titleByRecipe: Record<string, string>
  /**
   * Active shopping list. Inline "add another item" routes through
   * addManualItem(text, listId) so it lands on this list instead of
   * always the auto list.
   */
  activeListId?: string
}

export function GroceryList({ items, titleByRecipe, activeListId }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [manualText, setManualText] = useState('')
  const manualInputRef = useRef<HTMLInputElement>(null)

  // Optimistic purchased state. We track per-id flips so the tap
  // feels instant (checkbox toggles + the row immediately demotes to
  // the bottom of its aisle). On the next server-driven refresh the
  // props catch up and we clear the optimistic flips.
  const [pendingFlips, setPendingFlips] = useState<Set<string>>(new Set())

  function isChecked(item: ShoppingListRow) {
    if (pendingFlips.has(item.id)) return !item.purchased
    return item.purchased
  }

  function toggleItem(itemId: string) {
    setPendingFlips((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
    startTransition(async () => {
      await toggleShoppingItemPurchased(itemId)
      router.refresh()
      // Clear THIS id's pending flag — once the refresh lands the
      // server-confirmed `purchased` matches what we showed locally,
      // so the optimistic override is no longer needed.
      setPendingFlips((prev) => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    })
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const text = manualText.trim()
    if (!text) return
    startTransition(async () => {
      await addManualItem(text, activeListId)
      setManualText('')
      router.refresh()
      manualInputRef.current?.focus()
    })
  }

  function removeItem(itemId: string) {
    startTransition(async () => { await removeShoppingItem(itemId); router.refresh() })
  }

  // Group by aisle (Publix store order). Within each aisle, unpurchased
  // come first then purchased at the bottom — this matches how you
  // actually shop: check things off as you grab them, but they don't
  // jump out of the section.
  const grouped = useMemo(() => {
    const sortedItems = [...items].sort((a, b) => {
      const aChecked = isChecked(a) ? 1 : 0
      const bChecked = isChecked(b) ? 1 : 0
      if (aChecked !== bChecked) return aChecked - bChecked
      return a.sortOrder - b.sortOrder
    })
    return groupByAisle(sortedItems, (i) => i.text)
    // pendingFlips intentionally NOT a dep — re-sorting on every
    // optimistic toggle is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, pendingFlips])

  const totalCount = items.length
  const checkedCount = items.filter((i) => isChecked(i)).length

  function doPrint() {
    window.print()
  }

  const allChecked = totalCount > 0 && checkedCount === totalCount

  return (
    <div className="space-y-4">
      {/* MealPlanTabs is now rendered at the PAGE level
          (/meal-plan/grocery/page.tsx) so the ListSwitcher can sit
          immediately below the menu — same vertical rhythm as the
          other meal-plan area pages. Kept the import above so this
          component can be reused in a hypothetical setting where the
          tabs DO belong inline, but for the current /grocery route
          the page owns the tab row. */}
      {/* Print stylesheet. Uses display:none on app chrome (NOT
          position:absolute + visibility:hidden — that combo only
          renders page 1 in Chrome / HP Print-to-PDF). Hiding via
          display:none removes chrome from the flow, the printable
          region starts at the top of page 1 and paginates naturally
          across as many pages as needed. */}
      <style>{`
        @media print {
          /* Light, scrollable body for print. The dashboard shell is
             h-screen + overflow-hidden during normal use; both have to
             relax or the renderer clips at the viewport height. */
          html, body { background: white !important; color: black !important; }
          body * { box-shadow: none !important; }
          .vault-shell {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          .vault-shell > *:not(main) { display: none !important; }
          main {
            overflow: visible !important;
            height: auto !important;
            background: white !important;
            color: black !important;
          }
          /* Inside main, hide everything except the wrapper holding
             the page content, then drop print-hide elements within. */
          main > *:not(.print-keep) { display: none !important; }
          .print-keep { display: block !important; padding: 0 !important; }
          .print-hide { display: none !important; }

          /* Aisle list styling */
          [data-print="grocery"] {
            padding: 16px 24px !important;
            font: 11pt/1.4 system-ui, sans-serif !important;
            color: black !important;
            background: white !important;
          }
          [data-print="grocery"] .aisle-header {
            color: black !important;
            border-bottom: 1px solid #999 !important;
            margin-top: 14px !important;
            padding-bottom: 2px !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
            font-size: 9pt !important;
            letter-spacing: 0.06em !important;
            page-break-after: avoid;
            break-after: avoid;
          }
          [data-print="grocery"] .aisle-section {
            page-break-inside: avoid;
            break-inside: avoid;
            margin-bottom: 8px !important;
          }
          [data-print="grocery"] ul {
            border: 0 !important;
            background: transparent !important;
            list-style: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          [data-print="grocery"] li {
            border: 0 !important;
            background: transparent !important;
            padding: 3px 0 !important;
            page-break-inside: avoid;
            break-inside: avoid;
            color: black !important;
          }
          [data-print="grocery"] .pchk {
            display: inline-block !important;
            width: 14px !important; height: 14px !important;
            border: 1.5px solid #444 !important;
            border-radius: 2px !important;
            margin-right: 8px !important;
            vertical-align: -2px !important;
            background: white !important;
          }
          [data-print="grocery"] .row-text { color: black !important; }
          [data-print="grocery"] .recipe-label {
            color: #555 !important;
            font-size: 9pt !important;
            font-style: italic !important;
          }
        }
      `}</style>

      {/* Header — hidden on print */}
      <div className="flex items-center justify-between gap-2 print-hide">
        <Link
          href="/meal-plan"
          // Theme-aware "soft" pill — same accent ramp as the active
          // tabs but at lower intensity so it reads as a secondary
          // navigation button, not a primary CTA. whitespace-nowrap
          // stops the label from breaking onto a second line on narrow
          // screens (the source of the wrap Lance flagged).
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition"
          style={{
            backgroundColor: 'rgb(var(--accent-700) / 0.18)',
            color: 'rgb(var(--accent-200))',
            boxShadow:
              '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 10px rgb(var(--accent-500) / 0.2)',
          }}
        >
          <ArrowLeft size={14} />
          Back to plan
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg md:text-xl font-bold text-stone-100">List</h1>
          <HelpPopout
            title="List"
            sections={[
              {
                heading: 'Shop',
                tips: [
                  { title: 'Big checkbox', description: 'Tap to mark bought — row dims, line-through, and floats to the bottom of its aisle.' },
                  { title: 'Aisle headers', description: 'Items grouped Publix-style: Produce → Meat → Dairy → Pasta → Pantry → Spices → Frozen → Snacks → Beverages → Household.' },
                  { title: 'Add manual', description: 'Top input adds something on the fly while walking the store. Lands on the currently-viewed list.' },
                ],
              },
              {
                heading: 'Lists',
                tips: [
                  { title: 'List switcher', description: 'Pill at the top — switch between "From Meal Plan" and any named lists (Weekly shop, road trip, Costco run…).' },
                  { title: '+ New list', description: 'Inside the switcher. Each list has its own items; nothing crosses over.' },
                  { title: 'Rename / Delete / Clear', description: 'Per-list options in the switcher. Auto list can be cleared but not deleted.' },
                ],
              },
              {
                heading: 'Print / PDF',
                tips: [
                  { title: 'Print / PDF button', description: 'Opens the browser print dialog with a clean layout (no app chrome, empty checkboxes, aisle headers, paginates properly).' },
                  { title: 'Save as PDF', description: 'In the print dialog, pick "Save as PDF" as the destination. No separate export needed.' },
                ],
              },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={doPrint}
          aria-label="Print or save as PDF"
          title="Print — or pick &ldquo;Save as PDF&rdquo; in the print dialog to get a PDF"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 hover:text-stone-100 rounded-lg transition"
        >
          <Printer size={14} />
          Print / PDF
        </button>
      </div>

      {/* Quick-add — hidden on print */}
      <form onSubmit={submitManual} className="flex items-center gap-2 print-hide">
        <input
          ref={manualInputRef}
          type="text"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          placeholder="Add another item…"
          className="flex-1 px-3 py-2.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        />
        <button
          type="submit"
          disabled={manualText.trim() === ''}
          className="inline-flex items-center gap-1 px-3 py-2.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {/* Printable region begins. Title repeats here so it shows on the
          printed page (the screen header above is hidden when printing). */}
      <div data-print="grocery" className="space-y-4">
        <div className="hidden print:block">
          <h1 className="text-lg font-bold">Grocery list</h1>
          <p className="text-xs text-stone-500">
            {checkedCount > 0 ? `${checkedCount} of ${totalCount} checked` : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
          </p>
        </div>

        {totalCount === 0 ? (
          <p className="py-12 text-center text-sm text-stone-500">
            Empty. Pick recipes on the meal plan or add items above.
          </p>
        ) : (
          grouped.map(({ aisle, items: aisleItems }) => (
            <section key={aisle} className="aisle-section">
              <h2 className="aisle-header text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1.5">
                {aisle} <span className="text-stone-600 font-normal normal-case print-hide">({aisleItems.length})</span>
              </h2>
              <ul className="rounded-xl border border-stone-700/60 overflow-hidden bg-stone-900/40 divide-y divide-stone-800">
                {aisleItems.map((item) => {
                  const checked = isChecked(item)
                  const labels = item.recipeIds
                    .map((rid) => titleByRecipe[rid])
                    .filter(Boolean)
                  return (
                    <li
                      key={item.id}
                      className={`row flex items-center gap-3 px-3 py-3 transition ${checked ? 'bg-stone-900/60 opacity-60' : 'bg-stone-900/30'}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        aria-label={checked ? 'Mark not bought' : 'Mark bought'}
                        className="pchk shrink-0 flex items-center justify-center h-8 w-8 rounded-lg border-2 transition"
                        // The unchecked box ships in the user's theme accent
                        // (~30% brighter than the active-pill green so it
                        // reads as "pending action") with a soft glow. Once
                        // tapped the row commits and the box swaps to a
                        // calm black + white check — clear "done" state
                        // that's also kept theme-independent (so it reads
                        // the same on print mode without the screen
                        // emerald override blowing through to ink).
                        style={
                          checked
                            ? { backgroundColor: '#000', borderColor: '#000', color: '#fff' }
                            : {
                                backgroundColor: 'rgb(var(--accent-400))',
                                borderColor: 'rgb(var(--accent-300))',
                                boxShadow: '0 0 12px rgb(var(--accent-300) / 0.35)',
                              }
                        }
                      >
                        {/* The check mark is screen-only; print shows an empty box so
                            the printed list is a fresh shopping list you tick at the store. */}
                        {checked && <span className="text-base font-bold print-hide">✓</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`row-text text-base text-stone-100 ${checked ? 'line-through' : ''}`}>
                          {item.text}
                        </div>
                        {!item.isManual && labels.length > 0 && (
                          <div className="recipe-label text-[11px] text-stone-500 truncate mt-0.5">
                            for {labels.join(' · ')}
                          </div>
                        )}
                        {item.isManual && (
                          <div className="text-[11px] text-amber-500/80 mt-0.5 print-hide">added by you</div>
                        )}
                      </div>
                      {item.isManual && (
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          aria-label="Remove"
                          className="print-hide p-2 text-stone-600 hover:text-red-400 transition shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}

        {allChecked && (
          <p className="print-hide text-center text-xs text-stone-500 pt-4">
            All checked off — happy cooking.
          </p>
        )}
      </div>
    </div>
  )
}
