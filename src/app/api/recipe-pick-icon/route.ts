import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { DEFAULT_RECIPE_ICON } from '@/lib/recipe-icon-for'

// Claude-Haiku picks one illustrated PNG icon from the existing
// /icons/cobb/icons/Recipes/ library that best matches a recipe's title
// + tags. Same idea as recipe-icon-for.ts's keyword matcher, but with
// real semantic understanding ("Chicken Pot Pie" no longer trips the
// "chicken → roast_chicken" rule because Claude reads it as a pie).
//
// Auth required (don't burn the API key for anonymous callers). The
// client side caches the result in localStorage so we only pay for the
// inference once per (title, tags) combo per device. If the call fails
// for any reason — rate limit, parse error, network — the fallback is
// the same DEFAULT_RECIPE_ICON the keyword matcher uses, so the UI
// never breaks.

export const runtime = 'nodejs'

// Filenames live in public/icons/cobb/icons/Recipes/ — keep this list
// in sync with what actually exists in that folder. Order matters
// only for the prompt; Claude is told the model can return any of
// these by filename exactly.
const ICON_OPTIONS: Array<{ file: string; desc: string }> = [
  { file: 'breakfast.png',    desc: 'breakfast: pancakes, waffles, eggs, french toast, oatmeal, biscuits, bagels' },
  { file: 'cake.png',         desc: 'sweets + desserts: cakes, cupcakes, cookies, brownies, pies, tarts, cobblers, fudge' },
  { file: 'camping_food.png', desc: 'outdoor / campfire cooking, foil packs, kabobs over fire' },
  { file: 'roast_chicken.png', desc: 'chicken, poultry, turkey, roast bird (whole bird forms)' },
  { file: 'sandwich.png',     desc: 'handhelds: sandwiches, wraps, tacos, burritos, quesadillas, sliders' },
  { file: 'slow_cooker.png',  desc: 'slow-cooker / crockpot recipes regardless of protein' },
  { file: 'snacks.png',       desc: 'appetizers, dips, chips, popcorn, pretzels, party bites' },
  { file: 'steak.png',        desc: 'ground beef + pork dishes: burgers, meatballs, meatloaf, sausage' },
  { file: 'steak_dinner.png', desc: 'whole-cut beef: steak, ribeye, sirloin, filet, brisket' },
  { file: 'vegetables.png',   desc: 'salads, veggie sides, roasted vegetables, greens, slaws' },
  { file: 'recipes.png',      desc: 'generic fallback when nothing else fits (soups, casseroles, stews, pasta dishes, etc.)' },
]

const SYSTEM_PROMPT =
  'You pick a single illustrated icon for a recipe. Read the title and tags, then pick the icon whose description best fits the dish.\n\n' +
  'Available icons:\n' +
  ICON_OPTIONS.map((o) => `- ${o.file}: ${o.desc}`).join('\n') +
  '\n\nRules:\n' +
  '- Reply with ONLY the filename (e.g. `roast_chicken.png`).\n' +
  '- No markdown, no quotes, no extra text.\n' +
  '- Use slow_cooker.png if the title mentions "crockpot" or "slow cooker", even if the protein has its own icon.\n' +
  '- Use sandwich.png for tacos / burritos / wraps even though they\'re not literal sandwiches.\n' +
  '- Use recipes.png when the dish is a soup, casserole, stew, pasta, or anything else without a clean match.\n' +
  '- Slow-cooker chicken tacos → slow_cooker.png (cooking method beats protein beats form).\n' +
  '- "Chicken pot pie" → cake.png (pie form beats chicken protein).'

const VALID = new Set(ICON_OPTIONS.map((o) => o.file))
const BASE = '/icons/cobb/icons/Recipes/'

interface PickResult {
  iconPath: string
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
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string').slice(0, 8) : []

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Quietly fall back to the default — the page renders fine without
    // an inferred pick, so don't fail the request just because the key
    // isn't configured on this environment.
    const fallback: PickResult = { iconPath: DEFAULT_RECIPE_ICON }
    return NextResponse.json(fallback)
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      // Haiku because the task is tiny — title + tags in, filename
      // out, well under 50 tokens. Sonnet would be overkill.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Recipe title: ${title}\nTags: ${tags.join(', ') || '(none)'}`,
      }],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const raw = (textBlock?.text ?? '').trim().replace(/^[`'"]+|[`'"]+$/g, '')
    // The model sometimes wraps in markdown despite the prompt; trim
    // and grab the first .png filename it spat out.
    const match = raw.match(/[a-z_]+\.png/i)
    const candidate = (match?.[0] ?? '').toLowerCase()
    const file = VALID.has(candidate) ? candidate : 'recipes.png'
    return NextResponse.json({ iconPath: `${BASE}${file}` } satisfies PickResult)
  } catch (err) {
    // Fall back to the keyword default on any Anthropic / network
    // error. Bad icon is preferable to a broken page.
    console.warn('[recipe-pick-icon] inference failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ iconPath: DEFAULT_RECIPE_ICON } satisfies PickResult)
  }
}
