// Suggest a category + subcategory for a new entry. Used by the
// new-entry form: type a title + url, get a one-click "Use suggestion"
// pill that fills the category dropdowns.
//
// Body: { title: string; url?: string; type?: string }
// Returns: { categorySlug, subcategoryName?, confidence }

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, subcategories } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 15

interface SuggestionResult {
  categorySlug: string | null
  subcategoryName: string | null
  confidence: 'high' | 'medium' | 'low'
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Claude API not configured' }, { status: 500 })
  }

  let body: { title?: string; url?: string; type?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const title = body.title?.trim()
  if (!title || title.length < 2) {
    return NextResponse.json({ error: 'title too short' }, { status: 400 })
  }
  const url = body.url?.trim() ?? ''
  const type = body.type?.trim() ?? 'login'

  const [allCats, allSubs] = await Promise.all([
    db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories),
    db.select({ id: subcategories.id, name: subcategories.name, categoryId: subcategories.categoryId }).from(subcategories),
  ])

  // Build a compact category index for the prompt.
  const catLines = allCats.map((c) => {
    const subs = allSubs.filter((s) => s.categoryId === c.id).map((s) => s.name)
    const subList = subs.length > 0 ? `  subcategories: ${subs.join(', ')}` : ''
    return `- ${c.slug} (${c.name})${subList ? '\n' + subList : ''}`
  }).join('\n')

  const anthropic = new Anthropic()
  const r = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // fast + cheap; categorization doesn't need Sonnet
    max_tokens: 200,
    system: `You categorize new vault entries. Respond ONLY with JSON in this shape:
{
  "categorySlug": "<slug from the list — exact match>",
  "subcategoryName": "<exact subcategory name from that category, or null>",
  "confidence": "high" | "medium" | "low"
}

Pick the BEST single fit. If no category clearly fits, return categorySlug: null.
Don't invent slugs or subcategories — only use ones from the provided list.`,
    messages: [
      {
        role: 'user',
        content: `Type: ${type}
Title: ${title}
URL: ${url || '(none)'}

Available categories + subcategories:
${catLines}`,
      },
    ],
  })

  const text = r.content.find((b) => b.type === 'text')
  const raw = text && 'text' in text ? text.text : ''
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < 0) {
    return NextResponse.json({ error: 'No JSON in response' }, { status: 502 })
  }
  let parsed: SuggestionResult
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON from Claude' }, { status: 502 })
  }

  // Validate: categorySlug must exist in DB
  if (parsed.categorySlug && !allCats.some((c) => c.slug === parsed.categorySlug)) {
    parsed.categorySlug = null
    parsed.subcategoryName = null
  }
  // Validate: if subcategoryName is set, must exist under that category
  if (parsed.categorySlug && parsed.subcategoryName) {
    const cat = allCats.find((c) => c.slug === parsed.categorySlug)
    const sub = cat ? allSubs.find((s) => s.categoryId === cat.id && s.name === parsed.subcategoryName) : null
    if (!sub) parsed.subcategoryName = null
  }

  return NextResponse.json(parsed)
}
