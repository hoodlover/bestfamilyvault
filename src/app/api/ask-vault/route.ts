// Natural-language vault search.
//
// Body: { question: string }
// Returns: { matches: [{ id, kind, title, href, why }], rephrasal?: string }
//
// Pulls every entry + note the calling user can see, builds a compact
// index (titles + previews + categories), and asks Claude which items
// best answer the question. Cost per query: ~$0.002-0.01 depending on
// vault size.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull, or } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { entries, notes, categories } from '@/lib/db/schema'
import { decryptEntries, decryptNotes } from '@/lib/crypto'

export const runtime = 'nodejs'
export const maxDuration = 30

interface IndexItem {
  id: string
  kind: 'entry' | 'note'
  title: string
  type?: string
  category?: string
  snippet: string
  href: string
}

interface ClaudeMatch {
  id: string
  kind: 'entry' | 'note'
  why: string
}

function buildSnippet(parts: (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim()
  return joined.length > 200 ? joined.slice(0, 197) + '…' : joined
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  let body: { question?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const question = body.question?.trim()
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }
  if (question.length > 500) {
    return NextResponse.json({ error: 'question too long' }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Claude API not configured' }, { status: 500 })
  }

  // Pull everything the user can see. Mirrors dashboard visibility:
  // - isPersonal owner-only (superuser does NOT bypass)
  // - isPrivate superuser-only
  // - skip merged children (parentEntryId is null)
  const [rawEntries, rawNotes, allCats] = await Promise.all([
    db.select().from(entries).where(
      and(
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isNull(entries.parentEntryId),
      ),
    ),
    db.select().from(notes).where(
      and(
        isSuperuser ? undefined : eq(notes.isPrivate, false),
        or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
      ),
    ),
    db.select({ id: categories.id, name: categories.name }).from(categories),
  ])

  const catName = new Map(allCats.map((c) => [c.id, c.name]))
  const decryptedEntries = decryptEntries(rawEntries)
  const decryptedNotes = decryptNotes(rawNotes)

  const index: IndexItem[] = []
  for (const e of decryptedEntries) {
    const snippet = buildSnippet([
      e.url,
      e.username,
      e.bankName,
      e.cardNetwork,
      e.cardholderName,
      e.firstName && e.lastName ? `${e.firstName} ${e.lastName}` : null,
      e.phone,
      e.noteContent ? e.noteContent.slice(0, 120) : null,
    ])
    index.push({
      id: e.id,
      kind: 'entry',
      title: e.title,
      type: e.type,
      category: catName.get(e.categoryId),
      snippet,
      href: `/entries/${e.id}`,
    })
  }
  for (const n of decryptedNotes) {
    index.push({
      id: n.id,
      kind: 'note',
      title: n.title,
      category: n.categoryId ? catName.get(n.categoryId) : undefined,
      snippet: buildSnippet([n.content?.slice(0, 200)]),
      href: `/notes/${n.id}`,
    })
  }

  // Compact text index — title + key signal + category. Each line is
  // ~50-150 tokens. A vault of 500 items = ~30-50k tokens, well within
  // Claude's window.
  const indexText = index
    .map((i) => {
      const parts = [
        `[${i.kind}:${i.id}]`,
        i.title,
        i.type ? `(${i.type})` : '',
        i.category ? `· ${i.category}` : '',
      ].filter(Boolean).join(' ')
      const snippet = i.snippet ? `\n    ${i.snippet}` : ''
      return parts + snippet
    })
    .join('\n')

  const anthropic = new Anthropic()
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `You are a vault search assistant. The user has a personal/family password+notes vault. They ask a natural-language question; you find the best-matching items from a flat list of titles + brief previews.

Reply ONLY with JSON in this exact shape (no prose, no markdown fences):
{
  "matches": [
    { "id": "<the ID from [kind:id] tag>", "kind": "entry" | "note", "why": "one short sentence — why this matches" }
  ],
  "rephrasal": "if useful, a one-sentence restatement of what the user is looking for, otherwise null"
}

Rules:
- Up to 10 matches, ordered by relevance.
- Use the exact id from the [kind:id] tag.
- "why" must be specific — name the field that matched, not "this looks relevant"
- If nothing matches, return matches: []
- Don't invent ids.`,
    messages: [
      {
        role: 'user',
        content: `User question: ${question}\n\n=== Vault index ===\n${indexText}`,
      },
    ],
  })

  const text = r.content.find((b) => b.type === 'text')
  const raw = text && 'text' in text ? text.text : ''
  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd < 0) {
    return NextResponse.json({ error: 'Could not parse Claude response' }, { status: 502 })
  }

  let parsed: { matches: ClaudeMatch[]; rephrasal?: string | null }
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON from Claude' }, { status: 502 })
  }

  const byId = new Map(index.map((i) => [`${i.kind}:${i.id}`, i]))
  const matches = (parsed.matches ?? [])
    .map((m) => {
      const item = byId.get(`${m.kind}:${m.id}`)
      if (!item) return null
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        href: item.href,
        category: item.category,
        why: m.why,
      }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  return NextResponse.json({
    matches,
    rephrasal: parsed.rephrasal ?? null,
  })
}
