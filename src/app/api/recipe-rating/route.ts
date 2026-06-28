import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAllowedRecipeUrl } from '@/lib/recipe-hosts'

// Quick rating-only fetch for a recipe URL. Recipe pages embed a
// schema.org Recipe with an aggregateRating block; we yank just
// ratingValue + ratingCount/reviewCount and return them. Skips the
// full ingredient/method parse so the response is small (~50-100 ms
// of CPU after the network round-trip).
//
// Called by RecipeImportPanel in parallel for each web-search hit so
// the user can see star ratings inline and filter the list to top-
// rated recipes without paying the cost of a full import.

export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 8_000
const MAX_BYTES = 2 * 1024 * 1024

interface RatingResult {
  rating: number | null
  ratingCount: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRecipeNode(html: string): Record<string, any> | null {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    const raw = m[1].trim()
    if (!raw) continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    const node = pickRecipeNode(parsed)
    if (node) return node
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickRecipeNode(input: unknown): Record<string, any> | null {
  if (!input) return null
  if (Array.isArray(input)) {
    for (const item of input) {
      const got = pickRecipeNode(item)
      if (got) return got
    }
    return null
  }
  if (typeof input !== 'object') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = input as Record<string, any>
  if (Array.isArray(obj['@graph'])) {
    const got = pickRecipeNode(obj['@graph'])
    if (got) return got
  }
  const t = obj['@type']
  const types = Array.isArray(t) ? t : [t]
  if (types.some((x) => typeof x === 'string' && x.toLowerCase() === 'recipe')) {
    return obj
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRating(node: Record<string, any>): RatingResult {
  const r = node.aggregateRating
  if (!r) return { rating: null, ratingCount: null }

  let rating: number | null = null
  if (typeof r.ratingValue === 'number' && Number.isFinite(r.ratingValue)) {
    rating = r.ratingValue
  } else if (typeof r.ratingValue === 'string') {
    const n = Number(r.ratingValue)
    if (Number.isFinite(n)) rating = n
  }

  // ratingCount is the total ratings; reviewCount only counts written reviews.
  // Prefer ratingCount when both are present (it's usually larger / more honest).
  let ratingCount: number | null = null
  for (const key of ['ratingCount', 'reviewCount']) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v)) { ratingCount = v; break }
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^\d]/g, ''))
      if (Number.isFinite(n) && n > 0) { ratingCount = n; break }
    }
  }
  return { rating, ratingCount }
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BestFamilyVault/1.0; +https://bestfamilyvault.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const reader = res.body?.getReader()
    if (!reader) return await res.text()
    const decoder = new TextDecoder('utf-8')
    let total = 0
    let html = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) break
      html += decoder.decode(value, { stream: true })
    }
    html += decoder.decode()
    return html
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) return NextResponse.json({ error: 'url is required.' }, { status: 400 })

  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch {
    return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 })
  }
  if (!isAllowedRecipeUrl(parsedUrl)) {
    return NextResponse.json({ error: 'Host not on the recipe allowlist.' }, { status: 400 })
  }

  try {
    const html = await fetchHtml(url)
    const node = findRecipeNode(html)
    if (!node) return NextResponse.json({ rating: null, ratingCount: null })
    return NextResponse.json(extractRating(node))
  } catch (err) {
    // Rating is best-effort — return nulls on any error so the UI just
    // shows the result without stars rather than blowing up.
    return NextResponse.json({
      rating: null,
      ratingCount: null,
      error: err instanceof Error ? err.message : 'fetch failed',
    })
  }
}
