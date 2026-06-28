import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { categories, notes } from '@/lib/db/schema'
import { decryptNote } from '@/lib/crypto'
import { GUIDE_SLUG } from '@/lib/dead-now-what-config'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const input = body as {
    topicTag?: unknown
    lineIndex?: unknown
    before?: unknown
    after?: unknown
  }
  const topicTag = typeof input.topicTag === 'string' ? input.topicTag : ''
  const lineIndex = typeof input.lineIndex === 'number' ? input.lineIndex : -1
  const before = typeof input.before === 'string' ? input.before : ''
  const after = typeof input.after === 'string' ? input.after : ''

  if (!topicTag || lineIndex < 0) {
    return Response.json({ error: 'Missing matching field details.' }, { status: 400 })
  }

  const lanceCategory = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, GUIDE_SLUG))
    .then((rows) => rows[0])
  if (!lanceCategory) return Response.json({ answer: null })

  const sourceNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.categoryId, lanceCategory.id), eq(notes.isPersonal, false)))

  const source = sourceNotes.find((note) => (note.tags ?? []).includes(topicTag))
  if (!source) return Response.json({ answer: null })

  const content = decryptNote(source).content
  const line = content.split('\n')[lineIndex] ?? ''
  const answer = extractAnswer(line, before, after)
  return Response.json({ answer })
}

function extractAnswer(line: string, before: string, after: string): string | null {
  if (!line.trim() || /_{3,}/.test(line)) return null

  const candidates = [
    extractByExactParts(line, before, after),
    extractByLabel(line, before, after),
  ]
  const answer = candidates.find((item) => item && item.trim().length > 0)?.trim() ?? null
  if (!answer || /_{3,}/.test(answer)) return null
  return answer
}

function extractByExactParts(line: string, before: string, after: string): string | null {
  if (!before && !after) return null
  let rest = line
  if (before) {
    const idx = rest.indexOf(before)
    if (idx === -1) return null
    rest = rest.slice(idx + before.length)
  }
  if (after) {
    const idx = rest.indexOf(after)
    if (idx === -1) return null
    rest = rest.slice(0, idx)
  }
  return rest
}

function extractByLabel(line: string, before: string, after: string): string | null {
  const label = before.includes(':') ? before.slice(0, before.indexOf(':') + 1) : before
  if (!label.trim()) return null
  const idx = line.toLowerCase().indexOf(label.toLowerCase())
  if (idx === -1) return null
  let rest = line.slice(idx + label.length)
  if (after) {
    const suffixIdx = rest.toLowerCase().lastIndexOf(after.toLowerCase())
    if (suffixIdx !== -1) rest = rest.slice(0, suffixIdx)
  }
  return rest
}
