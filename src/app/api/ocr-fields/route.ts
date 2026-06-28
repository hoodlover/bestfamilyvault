import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import type { OcrFieldKind, ParsedOcrFields } from '@/lib/ocr-field-types'

export const runtime = 'nodejs'

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const ALLOWED_KINDS = new Set<OcrFieldKind>(['credit_card', 'identity'])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const kind = formData.get('kind')
  if (kind !== 'credit_card' && kind !== 'identity') {
    return NextResponse.json({ error: 'Unsupported scan type.' }, { status: 400 })
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Unsupported scan type.' }, { status: 400 })
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

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Field scan needs ANTHROPIC_API_KEY configured.' },
        { status: 500 },
      )
    }

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
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
            { type: 'text', text: promptFor(kind) },
          ],
        },
      ],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const fields = parseFields(textBlock?.text ?? '', kind)
    return NextResponse.json({ ...fields, engine: 'claude' })
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
      { error: err instanceof Error ? err.message : 'Field scan failed.' },
      { status: 500 },
    )
  }
}

function promptFor(kind: OcrFieldKind) {
  if (kind === 'credit_card') {
    return [
      'Read this payment card image and return only strict JSON.',
      'The image may show the FRONT or the BACK of the card — modern cards often print the number, name, and expiry on the back instead of the front. Read whichever fields are visible on the side shown; do not invent values.',
      'Use this shape: {"creditCard":{"cardholderName":"","cardNumber":"","expiryDate":"","cardNetwork":"","suggestedTitle":""},"rawText":""}.',
      'Use MM/YY for expiryDate. Use only digits for cardNumber. Omit fields you cannot read confidently.',
      'For suggestedTitle, write a short human label combining the issuing bank/brand visible on the card and the cardholder\'s FIRST NAME if present — e.g. "Chase Sapphire Mastercard - Alex", "Bluevine Business Debit", "Bank of America - Jordan". 60 characters max. If the bank/brand isn\'t legible, fall back to "<Network> - <FirstName>" (e.g. "Mastercard - Alex"). Omit suggestedTitle only if you can read literally nothing useful.',
      'Do not include CVV even if visible. Do not include markdown or commentary.',
    ].join(' ')
  }

  return [
    'Read this identity document image and return only strict JSON.',
    'Use this shape: {"identity":{"firstName":"","lastName":"","dateOfBirth":"","ssn":"","passport":"","driversLicense":"","suggestedTitle":""},"rawText":""}.',
    'Use MM/DD/YYYY for dateOfBirth when possible. Omit fields you cannot read confidently.',
    'For a driver license, put the license number in driversLicense. For a passport, put the passport number in passport.',
    'For suggestedTitle, write a short human label combining the holder\'s full name and the document type — e.g. "Alex Morgan Driver\'s License", "Jordan Lee Passport", "John Smith State ID". 60 characters max. Omit only if you can\'t read the name.',
    'Do not include markdown or commentary.',
  ].join(' ')
}

function parseFields(text: string, kind: OcrFieldKind): ParsedOcrFields {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as ParsedOcrFields
    if (kind === 'credit_card') {
      return { creditCard: cleanObject(parsed.creditCard), rawText: parsed.rawText }
    }
    return { identity: cleanObject(parsed.identity), rawText: parsed.rawText }
  } catch {
    return kind === 'credit_card' ? { creditCard: {}, rawText: text } : { identity: {}, rawText: text }
  }
}

function cleanObject(obj: object | undefined) {
  if (!obj) return {}
  return Object.fromEntries(
    Object.entries(obj)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : undefined])
      .filter(([, value]) => value),
  )
}
