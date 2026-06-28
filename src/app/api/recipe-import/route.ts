import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAllowedRecipeUrl } from '@/lib/recipe-hosts'

// Recipe import — fetch a public recipe page, find its schema.org/Recipe
// JSON-LD, return structured fields the new-recipe form can drop into.
//
// Defensive shape:
//   - Allowlisted hosts only (so the server isn't a free open-fetch proxy).
//     Allowlist lives in src/lib/recipe-hosts.ts and is shared with the
//     search route so search results never include un-importable sites.
//   - 10s timeout, 2 MB cap on the response body
//   - Auth required (the user has to be logged into the vault)

export const runtime = 'nodejs'

const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 2 * 1024 * 1024

interface ImportedRecipe {
  title: string | null
  ingredients: string[]
  method: string | null
  story: string | null
  servings: number | null
  sourceUrl: string
}

// Pull JSON-LD <script> blocks out of the HTML and return the Recipe node
// from any of them. Sites embed Recipe either as the top-level @type or as
// one entry in an @graph array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRecipeNode(html: string): Record<string, any> | null {
  // Slightly forgiving regex — handles attribute-order variations.
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const matches = html.matchAll(re)
  for (const m of matches) {
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
  // Array → recurse
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

  // schema.org @graph wrapper
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
function flattenInstructions(instr: any): string | null {
  if (!instr) return null
  if (typeof instr === 'string') return instr.trim() || null
  if (Array.isArray(instr)) {
    const lines: string[] = []
    for (let i = 0; i < instr.length; i++) {
      const step = instr[i]
      let text: string | null = null
      if (typeof step === 'string') text = step
      else if (step && typeof step === 'object') {
        // HowToStep nodes have either .text or .name; HowToSection has .itemListElement
        if (typeof step.text === 'string') text = step.text
        else if (typeof step.name === 'string') text = step.name
        else if (step.itemListElement) {
          const sub = flattenInstructions(step.itemListElement)
          if (sub) lines.push(sub)
          continue
        }
      }
      if (text) lines.push(`${i + 1}. ${text.trim()}`)
    }
    return lines.length > 0 ? lines.join('\n') : null
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseServings(value: any): number | null {
  if (value == null) return null
  // recipeYield can be a number, a string ("8 servings"), or an array
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = parseServings(v)
      if (n != null) return n
    }
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const m = value.match(/\d+/)
    if (m) {
      const n = Number(m[0])
      if (Number.isFinite(n) && n > 0) return Math.round(n)
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRecipe(node: Record<string, any>, sourceUrl: string): ImportedRecipe {
  const titleRaw = typeof node.name === 'string' ? node.name.trim() : null
  const ingredientsRaw = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : []
  const ingredients = ingredientsRaw
    .filter((s: unknown): s is string => typeof s === 'string')
    .map((s: string) => s.trim())
    .filter((s: string) => s !== '')

  const method = flattenInstructions(node.recipeInstructions)
  const description = typeof node.description === 'string' ? node.description.trim() : null
  const author = node.author && typeof node.author === 'object' && typeof node.author.name === 'string'
    ? node.author.name
    : null
  const story = description || (author ? `From ${author}.` : null)
  const servings = parseServings(node.recipeYield)

  return {
    title: titleRaw,
    ingredients,
    method,
    story,
    servings,
    sourceUrl,
  }
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Some sites gate behind a UA — pretend to be a normal browser.
        'User-Agent': 'Mozilla/5.0 (compatible; BestFamilyVault/1.0; +https://bestfamilyvault.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    const reader = res.body?.getReader()
    if (!reader) return await res.text()

    // Read up to MAX_BYTES, then bail. Avoids gigantic pages chewing memory.
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) {
        try { await reader.cancel() } catch {}
        break
      }
      chunks.push(value)
    }
    return new TextDecoder('utf-8').decode(concat(chunks))
  } finally {
    clearTimeout(timer)
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (typeof body.url !== 'string') {
    return NextResponse.json({ error: 'Missing url.' }, { status: 400 })
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(body.url)
  } catch {
    return NextResponse.json({ error: 'Could not parse that URL.' }, { status: 400 })
  }
  if (!isAllowedRecipeUrl(parsedUrl)) {
    return NextResponse.json(
      { error: `That site isn't on the import allowlist (yet). Try a recipe URL from AllRecipes, Food Network, Serious Eats, etc.` },
      { status: 400 },
    )
  }

  let html: string
  try {
    html = await fetchHtml(parsedUrl.toString())
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach that page.'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const node = findRecipeNode(html)
  if (!node) {
    return NextResponse.json(
      { error: 'No structured Recipe data on that page. Try a different URL — most major recipe sites embed it.' },
      { status: 422 },
    )
  }

  const mapped = mapRecipe(node, parsedUrl.toString())
  return NextResponse.json({ recipe: mapped })
}
