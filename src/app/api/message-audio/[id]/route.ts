import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { messages } from '@/lib/db/schema'

// Auth-checked proxy for a message's voice-memo blob. Only the sender or
// the recipient of the message can play it back. Same private-blob fetch
// pattern as /api/voice-memos/[userId].

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  const { id } = await params
  const row = await db
    .select({
      url: messages.voiceMemoBlobUrl,
      contentType: messages.voiceMemoContentType,
      fromUserId: messages.fromUserId,
      toUserId: messages.toUserId,
    })
    .from(messages)
    .where(eq(messages.id, id))
    .then((r) => r[0])

  if (!row?.url) return new NextResponse('No memo', { status: 404 })
  if (row.fromUserId !== session.user.id && row.toUserId !== session.user.id) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const blobRes = await fetch(row.url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    return new NextResponse('Failed to fetch memo', { status: 502 })
  }

  return new NextResponse(blobRes.body, {
    headers: {
      'Content-Type': row.contentType ?? 'audio/webm',
      'Cache-Control': 'private, no-cache',
      'Content-Disposition': 'inline',
    },
  })
}
