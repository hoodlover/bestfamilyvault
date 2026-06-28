import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'

// Cloud OCR powered by Claude Vision. Auth is required so random callers
// cannot burn the API key by hitting the endpoint with images.

export const runtime = 'nodejs'

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}. Use JPEG, PNG, GIF, or WebP.` },
      { status: 400 },
    )
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image is over 10 MB.' }, { status: 413 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Cloud OCR needs ANTHROPIC_API_KEY configured.' }, { status: 500 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text:
                'Extract every readable piece of text from this image. Preserve layout where it helps readability ' +
                '(e.g. line breaks between fields on an ID card). Do not add commentary, headings, or markdown - ' +
                'output only the extracted text. If the image contains no readable text, respond with exactly: (no text detected)',
            },
          ],
        },
      ],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const text = textBlock?.text.trim() ?? ''
    return NextResponse.json({ text, engine: 'claude' })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited. Try again in a moment.' }, { status: 429 })
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'OCR service auth failed.' }, { status: 502 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `OCR service error: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'OCR failed.' },
      { status: 500 },
    )
  }
}
