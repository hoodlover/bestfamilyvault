import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Pexels-powered real food photos for recipe rows. Lance asked for actual
// photography (option 2 of the explore-icon-options question) instead of
// the illustrated PNG icons.
//
// Pexels free tier: 200 calls/hr / 20,000 calls/month — comfortable for
// a six-person family even if everyone hits the recipes page daily.
// Sign up at https://www.pexels.com/api/ (instant approval, no card),
// drop the key in Vercel env as PEXELS_API_KEY, redeploy. Without the
// key the route returns 404 and the client falls through to the
// illustrated icon — page never breaks.
//
// Auth required so random callers don't burn the API budget. Photos are
// already-cached client-side via SmartRecipeIcon's localStorage, so the
// cost per recipe is one lifetime lookup per device.

export const runtime = 'nodejs'

interface PickResult {
  photoUrl: string
  /** Pexels photographer credit. Returned so the UI can surface attribution
   *  on the recipe detail page when we get around to it; the list view
   *  doesn't need to render it on every tiny thumbnail. */
  attribution?: { name: string; profileUrl: string }
}

interface PexelsPhoto {
  id: number
  src: {
    tiny?: string
    small?: string
    medium?: string
    large?: string
  }
  photographer?: string
  photographer_url?: string
}

interface PexelsSearchResponse {
  photos?: PexelsPhoto[]
}

/** Clean up the title before sending to Pexels. Strips the kind of
 *  prefixes ("Mom's", "Grandma's", "Easy", "Best") and parenthetical
 *  qualifiers that hurt search precision without changing what the dish
 *  IS. Leaves single-word recipes alone — they're already terse. */
function searchQueryFor(title: string, tags: readonly string[]): string {
  let q = title.toLowerCase().trim()
  // Drop possessive prefixes like "mom's pot roast" → "pot roast"
  q = q.replace(/^[a-z'’]+'s\s+/i, '')
  // Drop common subjective adjectives
  q = q.replace(/^(easy|quick|best|favorite|simple|the\s+best)\s+/i, '')
  // Drop parenthetical qualifiers
  q = q.replace(/\s*\([^)]*\)/g, '')
  // Drop trailing serving annotations
  q = q.replace(/\s*[-–—]\s*serves\s+\d+.*$/i, '')
  q = q.trim()

  // Add "food" if the title is short + might be ambiguous (e.g. "Tacos"
  // could match cars on Pexels without it). Two-word and longer titles
  // are usually specific enough.
  if (q.split(/\s+/).length === 1) q = `${q} food`

  // Splice the most useful tag (typically the cuisine / meal type) in
  // when available — "Tacos" + tag "Mains" → "tacos main course".
  const cuisineTag = tags.find((t) => /pasta|soup|salad|dessert|breakfast|mains?|side/i.test(t))
  if (cuisineTag) q = `${q} ${cuisineTag.toLowerCase()}`

  return q
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  let body: { title?: string; tags?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const title = (body.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'title is required.' }, { status: 400 })
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 4) : []

  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey) {
    // 404 (not 500) so the client treats this as "no photo available"
    // and falls cleanly through to the illustrated-icon route. Keeps
    // the page rendering even on environments without the key set.
    return NextResponse.json({ error: 'PEXELS_API_KEY not configured.' }, { status: 404 })
  }

  const query = searchQueryFor(title, tags)
  const url = new URL('https://api.pexels.com/v1/search')
  url.searchParams.set('query', query)
  url.searchParams.set('per_page', '1')
  url.searchParams.set('orientation', 'square')

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey },
      // Don't let Next cache Pexels responses indefinitely — recipes
      // get re-titled occasionally and we want the photo to follow.
      // Client localStorage cache handles per-device de-dup separately.
      cache: 'no-store',
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Pexels error: ${res.status}` }, { status: 502 })
    }
    const data = (await res.json()) as PexelsSearchResponse
    const photo = data.photos?.[0]
    // medium ~350x350; tiny ~280px tall. medium is sharper on retina
    // for the recipe-detail hero; the 44x44 row thumb won't care which.
    const photoUrl = photo?.src.medium ?? photo?.src.small ?? photo?.src.large ?? null
    if (!photoUrl) {
      return NextResponse.json({ error: 'No matching photo found.' }, { status: 404 })
    }
    const out: PickResult = {
      photoUrl,
      attribution: photo?.photographer && photo.photographer_url
        ? { name: photo.photographer, profileUrl: photo.photographer_url }
        : undefined,
    }
    return NextResponse.json(out)
  } catch (err) {
    console.warn('[recipe-pick-photo] Pexels fetch failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Pexels lookup failed.' }, { status: 502 })
  }
}
