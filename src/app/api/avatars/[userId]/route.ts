import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

// Proxies private Vercel Blob avatars so the browser can render them in <img>.
// Family members are allowed to view each other's avatars; unauthenticated
// requests are rejected.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { userId } = await params
  const wantSource = req.nextUrl.searchParams.get('source') === '1'

  const user = await db
    .select({ image: users.image, imageOriginal: users.imageOriginal })
    .from(users)
    .where(eq(users.id, userId))
    .then((r) => r[0])

  if (!user) return new NextResponse('Not found', { status: 404 })

  const blobUrl = wantSource ? user.imageOriginal : user.image
  if (!blobUrl) return new NextResponse('Not found', { status: 404 })

  const blobRes = await fetch(blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    return new NextResponse('Failed to fetch avatar', { status: 502 })
  }

  return new NextResponse(blobRes.body, {
    headers: {
      'Content-Type': blobRes.headers.get('content-type') ?? 'image/jpeg',
      // Avatars rarely change; allow short browser caching, but vary by the
      // ?v= query param in callers so updates show up immediately.
      'Cache-Control': 'private, max-age=60',
    },
  })
}
