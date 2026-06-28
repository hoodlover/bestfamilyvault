import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'

// Receipt scan via Claude Vision. Pulls merchant, total amount, and date
// off a photographed receipt. Mirrors the auth + media-type guards of the
// other OCR endpoints so a random caller can't burn the API key.

export const runtime = 'nodejs'
export const maxDuration = 30

const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export interface ParsedReceipt {
  merchant?: string
  totalCents?: number
  purchaseDate?: string // YYYY-MM-DD
  itemHint?: string
  rawText?: string
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
    return NextResponse.json(
      { error: 'Receipt scan needs ANTHROPIC_API_KEY configured.' },
      { status: 500 },
    )
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
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
              text: [
                'Read this receipt and return strict JSON only.',
                'Shape: {"merchant":"","totalCents":0,"purchaseDate":"YYYY-MM-DD","itemHint":"","rawText":""}.',
                'merchant: the store / business name printed at the top.',
                'totalCents: the final paid total in integer cents (e.g. $14.27 = 1427). Use the grand total, not subtotal.',
                'purchaseDate: ISO YYYY-MM-DD if a date is visible; otherwise omit.',
                'itemHint: a short phrase summarizing what was bought (≤40 chars), e.g. "Groceries", "Gas fill-up", "Coffee + bagel". Omit if unclear.',
                'rawText: a faithful plaintext transcription of the receipt body (line items + totals), for reference.',
                'Omit any field you cannot read confidently. Do not include markdown or commentary.',
              ].join(' '),
            },
          ],
        },
      ],
    })

    const textBlock = response.content.find(
      (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
    )
    const parsed = parseReceipt(textBlock?.text ?? '')
    return NextResponse.json({ ...parsed, engine: 'claude' })
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
      { error: err instanceof Error ? err.message : 'Receipt scan failed.' },
      { status: 500 },
    )
  }
}

function parseReceipt(text: string): ParsedReceipt {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>
    const out: ParsedReceipt = {}
    if (typeof obj.merchant === 'string' && obj.merchant.trim()) out.merchant = obj.merchant.trim()
    if (typeof obj.totalCents === 'number' && Number.isFinite(obj.totalCents)) {
      out.totalCents = Math.round(obj.totalCents)
    } else if (typeof obj.totalCents === 'string') {
      const n = Number(obj.totalCents)
      if (Number.isFinite(n)) out.totalCents = Math.round(n)
    }
    if (typeof obj.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.purchaseDate.trim())) {
      out.purchaseDate = obj.purchaseDate.trim()
    }
    if (typeof obj.itemHint === 'string' && obj.itemHint.trim()) {
      out.itemHint = obj.itemHint.trim().slice(0, 80)
    }
    if (typeof obj.rawText === 'string') out.rawText = obj.rawText
    return out
  } catch {
    return { rawText: text }
  }
}
