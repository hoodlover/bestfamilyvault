// Pick a representative icon for a recipe / meal-plan / grocery item by
// keyword-matching its title against the existing illustrated PNGs under
// public/icons/cobb/icons/Recipes/. Pure, deterministic, zero network —
// the lookup runs server-side per row at render time. When no keyword
// hits, the generic recipes.png falls through.
//
// Lance asked "do you have a way to read the title and grab an image
// that resembles the title?" — this is the cheap version of that. The
// expensive versions (Unsplash search, Claude vision, image gen) cost
// money and add latency; the keyword map covers most weeknight family
// recipes the vault sees with one local file lookup.
//
// To add coverage: drop a new PNG into /icons/cobb/icons/Recipes/ and
// add a row below. Earlier rules win, so put the most-specific phrases
// at the top (e.g. "slow cooker" before "chicken").

const BASE = '/icons/cobb/icons/Recipes/'

/** Fallback when no rule matches. */
export const DEFAULT_RECIPE_ICON = `${BASE}recipes.png`

/** Ordered list — first match wins. Phrases are lowercased substring
 *  tests on the title; multi-word phrases must appear contiguously. */
const RULES: Array<{ match: string[]; icon: string }> = [
  // Cooking-method specifics first so "slow cooker chicken" doesn't
  // resolve to plain chicken.
  { match: ['slow cook', 'crockpot', 'crock pot'], icon: `${BASE}slow_cooker.png` },
  { match: ['camp', 'campfire', 'foil pack'], icon: `${BASE}camping_food.png` },

  // Mains by protein / form factor.
  { match: ['chicken', 'poultry', 'turkey'], icon: `${BASE}roast_chicken.png` },
  { match: ['steak', 'ribeye', 'sirloin', 'filet'], icon: `${BASE}steak_dinner.png` },
  { match: ['burger', 'beef', 'meatball', 'meatloaf', 'pork', 'roast'], icon: `${BASE}steak.png` },
  { match: ['sandwich', 'wrap', 'panini', 'taco', 'burrito', 'quesadilla', 'sub ', 'sliders'], icon: `${BASE}sandwich.png` },

  // Sides + veg.
  { match: ['salad', 'broccoli', 'carrot', 'asparagus', 'roast vegetable', 'vegetable', 'veggie', 'greens'], icon: `${BASE}vegetables.png` },

  // Breakfast.
  { match: ['breakfast', 'pancake', 'waffle', 'omelet', 'omelette', 'scramble', 'french toast', 'biscuit', 'bagel'], icon: `${BASE}breakfast.png` },

  // Desserts + sweets — keep "cake" specific so it doesn't catch "cupcake holder" style.
  { match: ['cake', 'cupcake', 'cookie', 'brownie', 'pie', 'tart', 'dessert', 'cobbler', 'crumble', 'fudge'], icon: `${BASE}cake.png` },

  // Snacks + bites.
  { match: ['snack', 'popcorn', 'chip', 'pretzel', 'dip', 'appetizer'], icon: `${BASE}snacks.png` },
]

/** Returns a recipe icon path for the given title (and optional tag
 *  list). When nothing matches, the generic icon at DEFAULT_RECIPE_ICON
 *  is returned. */
export function recipeIconFor(title: string | null | undefined, tags: readonly string[] | null = null): string {
  const haystack = `${title ?? ''} ${(tags ?? []).join(' ')}`.toLowerCase()
  if (!haystack.trim()) return DEFAULT_RECIPE_ICON
  for (const rule of RULES) {
    for (const phrase of rule.match) {
      if (haystack.includes(phrase)) return rule.icon
    }
  }
  return DEFAULT_RECIPE_ICON
}
