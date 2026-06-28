import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, categories } from '@/lib/db/schema'
import { decryptNote } from '@/lib/crypto'

// Splits a recipe note into discrete cooking steps for the full-screen
// "Start recipe" cooking mode. Calls Claude Haiku once per recipe;
// the client caches the result in localStorage keyed by note id +
// content hash so we don't pay for re-splits on every cook.
//
// Output shape:
//   {
//     steps: [
//       { text: "Gather and measure all ingredients.", ingredients: [<all>] },
//       { text: "Preheat oven to 350°F.",              ingredients: [] },
//       { text: "Whisk flour, baking soda, and salt.", ingredients: ["2 cups flour", "1 tsp baking soda", "1/2 tsp salt"] },
//       ...
//     ]
//   }
//
// Auth required so random callers can't burn the API key on us.

export const runtime = 'nodejs'

interface CookStep {
  text: string
  ingredients: string[]
}

interface SplitResult {
  steps: CookStep[]
}

const SYSTEM_PROMPT =
  'You break a single recipe into cooking steps for a hands-busy cook reading from a phone screen in the kitchen.\n\n' +
  'Output a strict JSON object: { "steps": [ { "text": "...", "ingredients": ["1 cup flour", ...] }, ... ] }\n\n' +
  'Rules:\n' +
  '- Step 1 is always the prep / mise en place step. Its `text` should be a short directive like ' +
  '"Gather and measure all ingredients." and its `ingredients` array MUST contain EVERY ingredient ' +
  'from the recipe verbatim (preserve quantities, units, and order).\n' +
  '- Steps 2+ each have a short imperative `text` (≤ 30 words) describing ONE focused action. ' +
  'Preserve temperatures, times, and quantities exactly as written in the original method.\n' +
  '- Each step\'s `ingredients` array lists only the ingredients used in that step, copied verbatim ' +
  'from the recipe\'s ingredient list. Empty array when no ingredients are added in that step ' +
  '(e.g. "Preheat oven to 350°F.").\n' +
  '- Roughly 1 step per numbered method line if the recipe is numbered. If the method is prose, ' +
  'split on natural action boundaries — typically one sentence per step, more or less.\n' +
  '- Don\'t invent content or skip method content. The sum of all step texts should cover everything in the original method.\n' +
  '- Output ONLY the JSON object — no markdown fences, no commentary.'

function safeParse(raw: string): SplitResult | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as Partial<SplitResult>
    if (!Array.isArray(parsed.steps)) return null
    const steps = parsed.steps
      .map((s) => {
        if (!s || typeof s !== 'object') return null
        const text = typeof s.text === 'string' ? s.text.trim() : ''
        if (text === '') return null
        const ingredients = Array.isArray(s.ingredients)
          ? s.ingredients.filter((i): i is string => typeof i === 'string' && i.trim() !== '')
          : []
        return { text, ingredients }
      })
      .filter((s): s is CookStep => s !== null)
    if (steps.length === 0) return null
    return { steps }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  let body: { noteId?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const noteId = (body.noteId ?? '').trim()
  if (!noteId) return NextResponse.json({ error: 'noteId is required.' }, { status: 400 })

  const noteRow = await db.select().from(notes).where(eq(notes.id, noteId)).then((r) => r[0])
  if (!noteRow) return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 })

  // Visibility check mirrors the note detail page.
  if (noteRow.isPrivate && session.user.role !== 'superuser') {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }
  if (noteRow.isPersonal && noteRow.createdBy !== session.user.id) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }

  // Confirm it's a recipe — saves us from generating cook-mode JSON for
  // arbitrary notes that don't even have a method section.
  if (noteRow.categoryId) {
    const cat = await db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, noteRow.categoryId))
      .then((r) => r[0])
    if (cat?.slug !== 'recipes') {
      return NextResponse.json({ error: 'Cooking mode is only for recipes.' }, { status: 400 })
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Cooking mode needs ANTHROPIC_API_KEY configured.' }, { status: 500 })
  }

  const note = decryptNote(noteRow)
  const content = note.content ?? ''
  if (content.trim() === '') {
    return NextResponse.json({ error: 'This recipe has no content to split.' }, { status: 400 })
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Recipe title: ${note.title}\n\n${content}`,
      }],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const parsed = safeParse(textBlock?.text.trim() ?? '')
    if (!parsed) {
      return NextResponse.json(
        { error: 'Couldn\'t split this recipe into steps. The recipe might be too short or oddly formatted.' },
        { status: 422 },
      )
    }
    return NextResponse.json(parsed)
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Step-splitter service error: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Step-splitter failed.' },
      { status: 500 },
    )
  }
}
