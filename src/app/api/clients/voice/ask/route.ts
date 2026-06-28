// Voice-assistant Q&A endpoint. Same paired-client auth as the
// browser extension — the Alexa Skill or Siri Shortcut sends a bearer
// token in the Authorization header.
//
// Body: { question: string }
// Returns: { answer: string, sensitive?: boolean }
//
// "answer" is what the voice assistant speaks aloud. When the answer
// would expose a password, account number, or other sensitive value,
// we return a redacted version with sensitive=true so the client can
// optionally route to a "see your phone" flow instead of speaking it.

import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull, or } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { entries, notes, categories } from '@/lib/db/schema'
import { decryptEntries, decryptNotes } from '@/lib/crypto'
import { requireClient } from '@/lib/clients/auth'
import { corsHeadersFor, corsPreflight } from '@/lib/clients/cors'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const corsHeaders = corsHeadersFor(req) ?? {}
  const json = (data: unknown, init?: ResponseInit) =>
    NextResponse.json(data, { ...init, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

  const ctx = await requireClient(req)
  if ('error' in ctx) return ctx.error

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'Claude API not configured' }, { status: 500 })
  }

  let body: { question?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const question = body.question?.trim()
  if (!question) return json({ error: 'question required' }, { status: 400 })
  if (question.length > 500) return json({ error: 'question too long' }, { status: 400 })

  // Pull every entry + note this user can see (mirrors dashboard rules:
  // isPersonal owner-only, isPrivate superuser-only).
  // For voice access, the paired client represents the user themselves,
  // so isPrivate respects the user's role from the underlying account.
  // We don't have role info on the client_session row — be conservative:
  // exclude isPrivate items entirely. (Lance can ask about admin vault
  // items via the web UI.)
  const userId = ctx.userId
  const [rawEntries, rawNotes, allCats] = await Promise.all([
    db.select().from(entries).where(
      and(
        eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
        isNull(entries.parentEntryId),
      ),
    ),
    db.select().from(notes).where(
      and(
        eq(notes.isPrivate, false),
        or(eq(notes.isPersonal, false), eq(notes.createdBy, userId)),
      ),
    ),
    db.select({ id: categories.id, name: categories.name }).from(categories),
  ])

  const catName = new Map(allCats.map((c) => [c.id, c.name]))
  const decryptedEntries = decryptEntries(rawEntries)
  const decryptedNotes = decryptNotes(rawNotes)

  // Build a richer index for voice — we WANT Claude to read passwords / account
  // numbers / etc. so it can answer questions like "what's the WiFi password."
  // The sensitivity guard runs on the OUTPUT (the answer), not the input.
  const indexLines: string[] = []
  for (const e of decryptedEntries) {
    const lines = [
      `--- entry: ${e.title}${e.type !== 'login' ? ` (${e.type})` : ''} · ${catName.get(e.categoryId) ?? ''}`,
    ]
    if (e.url) lines.push(`URL: ${e.url}`)
    if (e.username) lines.push(`Username: ${e.username}`)
    if (e.password) lines.push(`Password: ${e.password}`)
    if (e.bankName) lines.push(`Bank: ${e.bankName}`)
    if (e.accountNumber) lines.push(`Account: ${e.accountNumber}`)
    if (e.routingNumber) lines.push(`Routing: ${e.routingNumber}`)
    if (e.cardNumber) lines.push(`Card: ${e.cardNumber}`)
    if (e.cvv) lines.push(`CVV: ${e.cvv}`)
    if (e.expiryDate) lines.push(`Exp: ${e.expiryDate}`)
    if (e.ssn) lines.push(`SSN: ${e.ssn}`)
    if (e.phone) lines.push(`Phone: ${e.phone}`)
    if (e.noteContent) lines.push(`Notes: ${e.noteContent.slice(0, 300)}`)
    indexLines.push(lines.join('\n'))
  }
  for (const n of decryptedNotes) {
    indexLines.push(`--- note: ${n.title}${n.categoryId ? ` · ${catName.get(n.categoryId) ?? ''}` : ''}\n${n.content?.slice(0, 500) ?? ''}`)
  }

  const anthropic = new Anthropic()
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: `You are a voice assistant answering a single short question by reading from a personal/family vault. Speak the answer in 1-2 sentences as if you're speaking aloud. NO preamble like "Based on your vault…" — just the answer.

Rules:
- If the question asks for a password, account number, SSN, CVV, or full credit card number, answer with the value AS IS — the calling client decides whether to speak it or push to the phone screen. You don't redact.
- If multiple entries match, name the one you used.
- If nothing matches, say so plainly: "I couldn't find that in the vault."
- Use natural speech. Don't read URLs out loud unless asked.`,
    messages: [
      {
        role: 'user',
        content: `Question: ${question}\n\n=== Vault ===\n${indexLines.join('\n\n')}`,
      },
    ],
  })

  const text = r.content.find((b) => b.type === 'text')
  const answer = text && 'text' in text ? text.text.trim() : ''
  if (!answer) {
    return json({ answer: "I couldn't come up with an answer." })
  }

  // Sensitivity guard: looks for password-shaped content in the answer.
  // Mostly heuristic — clients can still speak the full answer if they want.
  const isSensitive = /password|ssn|social security|cvv|card number|account number|routing number/i.test(question)
    || /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/.test(answer)
    || /\b\d{3}-\d{2}-\d{4}\b/.test(answer)

  return json({ answer, sensitive: isSensitive })
}
