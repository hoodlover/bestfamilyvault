import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { ALLOWED_RECIPE_HOST_SUFFIXES, isAllowedRecipeUrlString } from '@/lib/recipe-hosts'

// Recipe web search — uses Claude with the web_search server tool to find
// candidate recipes for a query. Returns just the metadata (title + URL
// + source); the actual import happens in /api/recipe-import which fetches
// the page and parses the schema.org Recipe JSON-LD.
//
// The search is strictly scoped to the same allowlist the import route
// uses (src/lib/recipe-hosts.ts) so a tap on a result is guaranteed to
// import successfully. Two layers enforce this:
//   1. The system prompt tells Claude to ONLY return URLs from the list.
//   2. After Claude returns, we filter the list server-side. Anything off
//      the allowlist (e.g. Pinterest, Reddit, random food blogs) is dropped.

export const runtime = 'nodejs'

const HOSTS_FOR_PROMPT = ALLOWED_RECIPE_HOST_SUFFIXES.join(', ')

const SYSTEM_PROMPT =
  'You are a recipe finder. Given a search query, find well-rated recipes matching the query.\n\n' +
  'CRITICAL CONSTRAINT: every URL you return MUST live on one of these exact hosts (or a subdomain ' +
  `thereof): ${HOSTS_FOR_PROMPT}. Do NOT return URLs from any other site — Pinterest, Reddit, ` +
  'random food blogs, Wikipedia, paywalled sites, video platforms, or anything else not on this list. ' +
  'If you cannot find recipes on these hosts for the query, return an empty array [] rather than ' +
  'substituting an off-list URL.\n\n' +
  'Use the web_search tool to find current recipes (you may add `site:allrecipes.com` etc. to focus ' +
  'searches on the allowed hosts). After searching, return a STRICT JSON array — no markdown fences, ' +
  'no commentary — with this exact shape:\n' +
  '[\n' +
  '  { "title": "Best Chocolate Chip Cookies", "url": "https://www.allrecipes.com/recipe/...", "source": "allrecipes.com", "brief": "Crispy edges, chewy middle." },\n' +
  '  ...\n' +
  ']\n\n' +
  'Each entry: title is the recipe name, url is the canonical recipe URL (NOT a search results page, ' +
  'NOT a hub/index page), source is the bare hostname (no www, no path), brief is a 1-sentence ' +
  'description (under 80 chars). Return up to 5 entries. If no good matches exist on the allowed hosts, ' +
  'return [].'

interface SearchResult {
  title: string
  url: string
  source: string
  brief: string
}

function safeParseJsonArray(raw: string): SearchResult[] | null {
  // Claude sometimes wraps JSON in fences despite instructions; strip them.
  let cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  // Sometimes the array is preceded by prose; grab from first '[' onward.
  const i = cleaned.indexOf('[')
  if (i > 0) cleaned = cleaned.slice(i)
  const j = cleaned.lastIndexOf(']')
  if (j !== -1 && j < cleaned.length - 1) cleaned = cleaned.slice(0, j + 1)
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
      .map((x) => ({
        title: typeof x.title === 'string' ? x.title : '',
        url: typeof x.url === 'string' ? x.url : '',
        source: typeof x.source === 'string' ? x.source : '',
        brief: typeof x.brief === 'string' ? x.brief : '',
      }))
      .filter((r) => r.title !== '' && r.url !== '')
      .slice(0, 5)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { query?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (query.length < 2) {
    return NextResponse.json({ error: 'Type at least 2 characters.' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Recipe search needs ANTHROPIC_API_KEY configured.' }, { status: 500 })
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      messages: [
        { role: 'user', content: `Search for recipes matching: "${query}". Return the JSON array as instructed.` },
      ],
    })

    // Walk the content blocks looking for the model's final text response.
    // web_search produces tool_use / tool_result blocks before the text.
    let lastText = ''
    for (const block of response.content) {
      if (block.type === 'text') lastText = block.text
    }
    const parsed = safeParseJsonArray(lastText.trim())
    if (!parsed) {
      return NextResponse.json({ error: 'Search came back unparseable. Try a different query.', raw: lastText }, { status: 502 })
    }
    // Belt + suspenders: drop anything Claude returned that isn't on the
    // import allowlist, even though the prompt forbids it. This is the
    // guarantee — only URLs the import route can actually fetch make it
    // back to the user.
    const results = parsed.filter((r) => isAllowedRecipeUrlString(r.url))
    return NextResponse.json({ results })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 })
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'Recipe search auth failed.' }, { status: 502 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Recipe search service error: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recipe search failed.' },
      { status: 500 },
    )
  }
}
