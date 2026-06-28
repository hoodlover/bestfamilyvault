// Document Q&A — pose a question about an attached file. The route
// performs the same access checks the file-render route does, fetches
// the blob server-side with the storage token, and forwards it to
// Claude as a document/image content block.
//
// Body: { fileId: string; question: string }
// Returns: { answer: string }

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { files, entries, notes } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const maxDuration = 60

const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  let body: { fileId?: string; question?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const fileId = body.fileId?.trim()
  const question = body.question?.trim()
  if (!fileId || !question) {
    return NextResponse.json({ error: 'fileId and question are required' }, { status: 400 })
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: 'Question too long (max 1000 chars)' }, { status: 400 })
  }

  const file = await db.select().from(files).where(eq(files.id, fileId)).then((r) => r[0])
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })
  if (file.isPrivate && !isSuperuser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Inherit visibility from parent entry/note (same rules as the file
  // render route).
  if (file.entryId) {
    const parent = await db
      .select({ isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
      .from(entries)
      .where(eq(entries.id, file.entryId))
      .then((r) => r[0])
    if (parent?.isPrivate && !isSuperuser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (parent?.isPersonal && parent.createdBy !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (file.noteId) {
    const parent = await db
      .select({ isPrivate: notes.isPrivate, isPersonal: notes.isPersonal, createdBy: notes.createdBy })
      .from(notes)
      .where(eq(notes.id, file.noteId))
      .then((r) => r[0])
    if (parent?.isPrivate && !isSuperuser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (parent?.isPersonal && parent.createdBy !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  if (!SUPPORTED_TYPES.has(file.contentType)) {
    return NextResponse.json({
      error: `Q&A only supports PDFs and images right now (this is ${file.contentType}).`,
    }, { status: 400 })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Claude API not configured.' }, { status: 500 })
  }

  // Fetch the blob with the storage token (private blobs require it).
  const blobRes = await fetch(file.blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    return NextResponse.json({ error: 'Failed to load attached file' }, { status: 502 })
  }
  const buffer = Buffer.from(await blobRes.arrayBuffer())
  const sizeMB = buffer.length / 1024 / 1024
  if (sizeMB > 30) {
    return NextResponse.json({
      error: `File is ${sizeMB.toFixed(1)} MB — too large for Claude (30 MB limit).`,
    }, { status: 400 })
  }

  const isPdf = file.contentType === 'application/pdf'
  const sourceBlock = isPdf
    ? {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: buffer.toString('base64'),
        },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: file.contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: buffer.toString('base64'),
        },
      }

  const anthropic = new Anthropic()
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `You are answering a question about a single document the user has attached to their personal vault. Answer concisely. If the document doesn't contain enough information to answer, say so plainly — don't speculate. Quote specific values, dates, or amounts from the document when possible. Skip preambles like "Based on the document..." — answer directly.`,
    messages: [
      {
        role: 'user',
        content: [sourceBlock, { type: 'text', text: question }],
      },
    ],
  })

  const text = r.content.find((b) => b.type === 'text')
  const answer = text && 'text' in text ? text.text : 'No answer.'

  return NextResponse.json({ answer })
}
