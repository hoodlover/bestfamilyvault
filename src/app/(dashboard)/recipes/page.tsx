import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { notes } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { Plus, Star } from 'lucide-react'
import { ensureRecipesCategory } from '@/lib/actions/recipes'
import { abbreviateRecipeTag } from '@/lib/recipe-tag-abbrev'
import { HelpPopout } from '@/components/ui/help-popout'
import { MealPlanTabs } from '@/components/ui/meal-plan-tabs'
import { SmartRecipeIcon } from '@/components/ui/smart-recipe-icon'

// Filter chips wire to ?type=… URL param. Set to a tag value present on
// recipe rows (matches the keys of recipe-tag-abbrev.ts ABBREV table).
// "All" clears the param. Server-rendered; no client state needed.
const FILTER_CHIPS = ['All', 'Meat', 'Soups', 'Breads', 'Desserts'] as const

interface PageProps {
  searchParams: Promise<{ type?: string }>
}

export default async function RecipesIndexPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  // Idempotent — superusers seed the Recipes category on first visit; for
  // other roles this just looks it up.
  const recipesCat = await ensureRecipesCategory()

  // No category yet (non-superuser, never seeded) → empty-state nudge.
  let rows: Awaited<ReturnType<typeof loadRecipes>> = []
  if (recipesCat) rows = await loadRecipes(recipesCat.id)

  const isReadonly = session.user.role === 'readonly'

  // Active filter from ?type=. Normalize against the known chip list so
  // arbitrary URL values don't render as "selected." rows are filtered by
  // tag inclusion; "All" / unknown skips the filter.
  const { type: activeRaw } = await searchParams
  const activeFilter =
    activeRaw && (FILTER_CHIPS as readonly string[]).includes(activeRaw) ? activeRaw : 'All'
  const filteredRows = activeFilter === 'All'
    ? rows
    : rows.filter((r) => (r.tags ?? []).includes(activeFilter))

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <MealPlanTabs active="recipes" />
      {/* ───────────────── Mobile redesign (md:hidden) ─────────────────
          Spec-faithful tight header (title + count + 40px add icon),
          subline tagline, then a vertical card-row list per recipe.
          Filter chips intentionally skipped — they'd need URL state for
          a server component, which is a follow-up. Desktop's grid layout
          stays in hidden md:block below. */}
      <div className="md:hidden">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-stone-100 flex-1 truncate">Recipes</h1>
          {recipesCat && (
            <span className="text-xs font-mono text-stone-500">{rows.length}</span>
          )}
          {recipesCat && !isReadonly && (
            <Link
              href="/recipes/new"
              aria-label="New recipe"
              className="inline-flex items-center justify-center -mr-1 active:scale-95 transition shrink-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/cobb/icons/system/add_recipe.png"
                width={40}
                height={40}
                alt=""
                className="h-10 w-10 object-contain"
              />
            </Link>
          )}
        </div>
        <p className="text-xs text-stone-500 mb-4">Handed down, written down, kept around.</p>

        {/* Filter chips — URL-driven, server-rendered. Active chip = accent
            pill; others = quiet outline. "All" clears the ?type= param. */}
        {recipesCat && rows.length > 0 && (
          <div className="flex gap-2 mb-5 overflow-x-auto -mx-4 px-4 pb-1">
            {FILTER_CHIPS.map((chip) => {
              const isActive = chip === activeFilter
              const href = chip === 'All' ? '/recipes' : `/recipes?type=${encodeURIComponent(chip)}`
              return (
                <Link
                  key={chip}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition'
                      : 'shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium text-stone-400 bg-stone-900/40 border border-stone-700/40 hover:text-stone-200 transition'
                  }
                  // Inline style for the active pill — see MealPlanTabs.
                  style={
                    isActive
                      ? {
                          backgroundColor: 'rgb(var(--accent-500))',
                          color: 'white',
                          boxShadow:
                            '0 0 0 2px rgb(var(--accent-300) / 0.65), 0 4px 14px rgb(var(--accent-400) / 0.45)',
                        }
                      : undefined
                  }
                >
                  {chip}
                </Link>
              )
            })}
          </div>
        )}

        {!recipesCat && (
          <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
            <p className="text-sm">The Recipes category hasn&rsquo;t been set up yet.</p>
            <p className="text-xs mt-1">Have a superuser visit this page once — it auto-creates on first visit.</p>
          </div>
        )}

        {recipesCat && rows.length === 0 && (
          <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
            <p className="text-sm">No recipes saved yet.</p>
            {!isReadonly && (
              <Link
                href="/recipes/new"
                className="mt-2 inline-block text-accent-300 hover:text-accent-200 text-sm transition"
              >
                + Add the first one
              </Link>
            )}
          </div>
        )}

        {rows.length > 0 && filteredRows.length === 0 && (
          <div className="text-center py-10 text-stone-500 border border-dashed border-stone-700 rounded-xl">
            <p className="text-sm">No recipes tagged &ldquo;{activeFilter}&rdquo;.</p>
            <Link href="/recipes" className="mt-2 inline-block text-accent-300 hover:text-accent-200 text-sm transition">
              Show all
            </Link>
          </div>
        )}

        {filteredRows.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {filteredRows.map((r) => (
              <Link
                key={r.id}
                href={`/notes/${r.id}`}
                className="vault-card vault-card-hover flex items-center gap-3 rounded-xl p-3"
              >
                {/* Claude-Haiku picks the best illustrated PNG for this
                    recipe — falls back to recipeIconFor's keyword pick
                    until the lazy fetch lands, then upgrades in place
                    and caches in localStorage so subsequent visits are
                    instant. */}
                <SmartRecipeIcon
                  title={r.title}
                  tags={r.tags ?? []}
                  width={44}
                  height={44}
                  className="h-11 w-11 object-contain shrink-0"
                  style={{ filter: 'brightness(1.08) saturate(1.05)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-stone-100 truncate">{r.title}</div>
                  <div className="mt-1">
                    {/* Serves N now renders as a soft theme pill (same
                        recipe as the Back-to-plan button on the grocery
                        page) so the meta line carries a touch of color. */}
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap"
                      style={{
                        backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                        color: 'rgb(var(--accent-200))',
                        boxShadow:
                          '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 8px rgb(var(--accent-500) / 0.18)',
                      }}
                    >
                      {r.servings != null ? `Serves ${r.servings}` : 'Recipe'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.isFavorite && (
                    // Gold star (not accent) — matches the spec's "favorites use
                    // the treasure/gold accent" cue, separate from the per-user
                    // accent theme so themed users still see a star color.
                    <Star size={13} className="text-[#d8a531] fill-[#d8a531]" />
                  )}
                  {(r.tags ?? []).slice(0, 2).map((t) => (
                    // Same soft theme pill as Serves so the row carries
                    // matching color cues left → right.
                    <span
                      key={t}
                      title={t}
                      className="font-mono text-[9.5px] font-semibold tracking-wider px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                        color: 'rgb(var(--accent-200))',
                        boxShadow:
                          '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 8px rgb(var(--accent-500) / 0.18)',
                      }}
                    >
                      {abbreviateRecipeTag(t)}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ───────────────── Desktop layout (hidden on mobile) ───────────── */}
      <div className="hidden md:block">
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/Recipes/recipes_book.png"
            alt=""
            width={48}
            height={48}
            className="block h-12 w-12 object-contain shrink-0 rounded-xl"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">Recipes</h1>
              <HelpPopout
                title="Recipes"
                sections={[
                  {
                    heading: 'Add a recipe',
                    tips: [
                      { title: 'Web search', description: 'On New Recipe, type a query — Claude searches well-rated recipe sites and returns 4.5+ star results with star ratings.' },
                      { title: 'Paste a URL', description: 'Drop any recipe URL — JSON-LD parser fills the form with ingredients, method, story, servings.' },
                      { title: 'Photo OCR', description: 'Snap up to 3 pages of a cookbook / index card / handwritten note. Claude reads it and fills the form.' },
                      { title: 'Type by hand', description: 'Structured form: amount + unit dropdowns + ingredient typeahead. Big ingredient list of common spices and pantry items.' },
                    ],
                  },
                  {
                    heading: 'Browse',
                    tips: [
                      { title: 'Subcategory pills', description: 'Click into a recipe-type subcategory on the Recipes category page. Holidays nests Christmas / Easter / Thanksgiving as children.' },
                      { title: 'Card pills', description: 'Three-letter abbrev pills (SLO, MEA, DES…) on each card show its recipe types at a glance.' },
                    ],
                  },
                  {
                    heading: 'Open a recipe',
                    tips: [
                      { title: 'Start recipe', description: 'Full-screen cooking mode: huge step text, prev/next, per-step read-aloud, keeps the phone screen on.' },
                      { title: 'Add to meal plan', description: 'Drops it into this week\'s plan with ×1 by default.' },
                      { title: 'Edit', description: 'Structured editor: subcategory chips, ingredient list, method, story, servings — no more one big paragraph.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              Family recipes — handed down, written down, kept around. {rows.length} on file.
            </p>
          </div>
        </div>
        {recipesCat && !isReadonly && (
          <Link
            href="/recipes/new"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
          >
            <Plus size={14} />
            New recipe
          </Link>
        )}
      </div>

      {!recipesCat && (
        <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">The Recipes category hasn&rsquo;t been set up yet.</p>
          <p className="text-xs mt-1">Have a superuser visit this page once — it auto-creates on first visit.</p>
        </div>
      )}

      {recipesCat && rows.length === 0 && (
        <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">No recipes saved yet.</p>
          {!isReadonly && (
            <Link
              href="/recipes/new"
              className="mt-2 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition"
            >
              + Add the first one
            </Link>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/notes/${r.id}`}
              className="flex items-start justify-between gap-3 px-4 py-3 rounded-xl border border-stone-700/50 bg-stone-800/40 hover:border-stone-600 hover:bg-stone-800 transition"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <div className="text-sm font-semibold text-stone-200 truncate">{r.title}</div>
                  {r.isFavorite && (
                    <Star size={12} className="text-emerald-400 fill-emerald-400 shrink-0" />
                  )}
                </div>
                <div className="mt-0.5 text-xs text-stone-500 flex items-center gap-2 flex-wrap">
                  {r.servings != null && (
                    <span className="text-stone-400">Serves {r.servings}</span>
                  )}
                  {(r.tags ?? []).slice(0, 5).map((t) => (
                    <span
                      key={t}
                      title={t}
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider text-emerald-300 bg-emerald-950/40 border border-emerald-800/40"
                    >
                      {abbreviateRecipeTag(t)}
                    </span>
                  ))}
                  <span>{r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : ''}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      </div>{/* /hidden md:block — desktop wrapper */}
    </div>
  )
}

// Explicit column list keeps this resilient if `note` ever gets new columns
// before they're pushed to prod (auth.ts and others learned this lesson).
async function loadRecipes(categoryId: string) {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      isFavorite: notes.isFavorite,
      servings: notes.servings,
      tags: notes.tags,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(eq(notes.categoryId, categoryId))
    .orderBy(desc(notes.updatedAt))
}
