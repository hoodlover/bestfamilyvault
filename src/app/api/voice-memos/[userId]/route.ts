import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

// Auth-checked proxy for the private voice-memo blob. Any signed-in family
// member can play any other member's memo (the egg is meant to be discovered
// across the family). Same content-type as the original upload.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 })

  const { userId } = await params
  const target = await db
    .select({ url: users.voiceMemoBlobUrl, contentType: users.voiceMemoContentType })
    .from(users)
    .where(eq(users.id, userId))
    .then((r) => r[0])

  if (!target?.url) return new NextResponse('No memo', { status: 404 })

  const blobRes = await fetch(target.url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    return new NextResponse('Failed to fetch memo', { status: 502 })
  }

  return new NextResponse(blobRes.body, {
    headers: {
      'Content-Type': target.contentType ?? 'audio/webm',
      'Cache-Control': 'private, no-cache',
      // Inline so <audio> can play it directly.
      'Content-Disposition': 'inline',
    },
  })
}
