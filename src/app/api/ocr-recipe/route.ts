import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'

// Cookbook / handwritten-recipe OCR powered by Claude vision. The page
// upload(s) (multipart, file=... repeated up to 3 times for a recipe
// that spans facing pages) is fed to claude-opus-4-7 with a prompt that
// asks for structured JSON: title + ingredients[] + method + story.
// Returns those fields raw so the recipe form can drop them straight
// into its existing state.
//
// Auth required so random callers cannot burn the API key.

export const runtime = 'nodejs'

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

interface ParsedRecipe {
  title: string | null
  ingredients: string[]
  method: string | null
  story: string | null
  servings: number | null
}

const SYSTEM_PROMPT =
  'You read one or more photographed pages of a single recipe (cookbook, index card, handwritten note, ' +
  'magazine clipping). When multiple images are provided, treat them as consecutive pages of the SAME ' +
  'recipe (e.g. ingredients on page 1, method continuing on page 2) and merge them into one combined ' +
  'result. Return a strict JSON object with these keys:\n' +
  '  title:        string | null    – the recipe name as written.\n' +
  '  ingredients:  string[]         – each entry is one ingredient line (e.g. "1 cup flour").\n' +
  '                                   Preserve quantities and units. One item per array element.\n' +
  '                                   Do NOT include the word "Ingredients" itself.\n' +
  '  method:       string | null    – the steps, joined with newlines. Preserve numbering if present.\n' +
  '                                   Do NOT include the word "Method"/"Directions"/"Instructions".\n' +
  '  story:        string | null    – any prose around the recipe (notes, headnote, "from grandma", etc.).\n' +
  '                                   null when the page is just ingredients + steps.\n' +
  '  servings:     number | null    – number of servings the recipe yields. Pull from "Serves 4",\n' +
  '                                   "Yield: 8", "Makes 12 cookies" type lines. Best integer estimate;\n' +
  '                                   null if absent.\n' +
  '\n' +
  'Output ONLY the JSON object, no markdown fences, no commentary. If a field is unreadable or absent, ' +
  'use null (or [] for ingredients). Best-effort: if handwriting is messy, give your best transcription rather than refusing.'

function safeParseJson(raw: string): ParsedRecipe | null {
  // Strip a possible ```json fence the model might still wrap around the
  // payload despite the instruction.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned) as Partial<ParsedRecipe>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : null,
      ingredients: Array.isArray(parsed.ingredients)
        ? parsed.ingredients.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        : [],
      method: typeof parsed.method === 'string' ? parsed.method : null,
      story: typeof parsed.story === 'string' ? parsed.story : null,
      servings: typeof parsed.servings === 'number' && Number.isFinite(parsed.servings) && parsed.servings > 0
        ? Math.round(parsed.servings)
        : null,
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const rawFiles = formData.getAll('file').filter((f): f is File => f instanceof File)
  if (rawFiles.length === 0) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }
  if (rawFiles.length > 3) {
    return NextResponse.json({ error: 'Max 3 pages per scan.' }, { status: 400 })
  }
  for (const f of rawFiles) {
    if (!ALLOWED_MEDIA_TYPES.has(f.type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${f.type}. Use JPEG, PNG, GIF, or WebP.` },
        { status: 400 },
      )
    }
    if (f.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'One of the images is over 10 MB.' }, { status: 413 })
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Recipe scan needs ANTHROPIC_API_KEY configured.' }, { status: 500 })
  }

  const imageBlocks = await Promise.all(
    rawFiles.map(async (f) => {
      const ab = await f.arrayBuffer()
      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: f.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: Buffer.from(ab).toString('base64'),
        },
      }
    }),
  )

  const promptText = rawFiles.length === 1
    ? 'Transcribe this recipe page into the JSON shape I described.'
    : `Transcribe these ${rawFiles.length} pages of the same recipe into one combined JSON object as I described. The pages are in order.`

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: promptText },
          ],
        },
      ],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const raw = textBlock?.text.trim() ?? ''
    const parsed = safeParseJson(raw)
    if (!parsed) {
      return NextResponse.json(
        { error: 'Could not read a recipe from that photo. Try a clearer shot or save it as an image only.', raw },
        { status: 422 },
      )
    }
    return NextResponse.json({ recipe: parsed })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 })
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'Recipe scan auth failed.' }, { status: 502 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Recipe scan service error: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Recipe scan failed.' },
      { status: 500 },
    )
  }
}
