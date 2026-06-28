// Single source of truth for which recipe sites the vault is willing to
// import from. Both /api/recipe-search (Claude web search) and
// /api/recipe-import (URL fetch + JSON-LD parse) read this list, so a
// search result that lands here is guaranteed to be importable too.
//
// Trimmed to sites that
//   (a) reliably embed schema.org/Recipe JSON-LD, and
//   (b) don't paywall the ingredient list to anonymous fetches.
//
// Add new hosts here only after confirming the URL fetch + parse round-trip
// works end-to-end on a real recipe page from that site.

export const ALLOWED_RECIPE_HOST_SUFFIXES = [
  'allrecipes.com',
  'foodnetwork.com',
  'simplyrecipes.com',
  'seriouseats.com',
  'kingarthurbaking.com',
  'thekitchn.com',
  'eatingwell.com',
  'tasteofhome.com',
  'food.com',
  'budgetbytes.com',
  'cookieandkate.com',
  'minimalistbaker.com',
  'sallysbakingaddiction.com',
  'pinchofyum.com',
] as const

/** True when a parsed URL's host matches (or is a subdomain of) any
 *  allowlisted suffix. */
export function isAllowedRecipeUrl(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return ALLOWED_RECIPE_HOST_SUFFIXES.some(
    (s) => host === s || host.endsWith('.' + s),
  )
}

/** Same check but tolerates a string that may not parse as a URL. */
export function isAllowedRecipeUrlString(raw: string): boolean {
  try {
    return isAllowedRecipeUrl(new URL(raw))
  } catch {
    return false
  }
}
