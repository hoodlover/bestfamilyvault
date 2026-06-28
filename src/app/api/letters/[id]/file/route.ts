import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { letters, letterRelease } from '@/lib/db/schema'
import { recipientSlugForUserName } from '@/lib/letters-recipients'

// Proxies a private Vercel Blob letter attachment so the browser can
// stream it (image / pdf / audio / video) under the SAME release-gate
// logic that controls who can see the letter row in the first place.
//
// Why this exists:
//   • Letter blobs were uploaded with access: 'private' so the URL alone
//     doesn't grant access — without this proxy the browser gets 403
//     Forbidden when trying to play a video <video> tag.
//   • Range requests are forwarded to Vercel Blob so video seeking and
//     iOS Safari work. (Safari refuses to start playing a video that
//     doesn't respond 206 Partial Content to its initial Range probe.)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { id } = await params
  const letter = await db.select().from(letters).where(eq(letters.id, id)).then((r) => r[0])
  if (!letter) return new NextResponse('Not found', { status: 404 })
  if (!letter.fileUrl) return new NextResponse('No attachment', { status: 404 })

  // Access logic mirrors src/app/(dashboard)/letters/page.tsx:
  //   • Superuser sees everything regardless of release state.
  //   • Everyone else can only fetch a letter (a) addressed to their
  //     own recipient slug AND (b) after the release gate has flipped.
  const isSuperuser = session.user.role === 'superuser'
  if (!isSuperuser) {
    const releaseRow = await db.select().from(letterRelease).limit(1).then((r) => r[0])
    const isReleased = releaseRow?.releasedAt != null && releaseRow.releasedAt <= new Date()
    const mySlug = recipientSlugForUserName(session.user.name ?? null)
    if (!isReleased || !mySlug || mySlug !== letter.recipientName) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Forward Range header so video scrubbing and progressive playback work.
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
  }
  const range = req.headers.get('range')
  if (range) upstreamHeaders.Range = range

  const blobRes = await fetch(letter.fileUrl, { headers: upstreamHeaders })

  // If Vercel Blob 4xx/5xxs us, surface that — otherwise the user just
  // sees a vague Forbidden and we can't tell what's going on from logs.
  if (!blobRes.ok && blobRes.status !== 206) {
    return new NextResponse(`Upstream blob fetch failed: ${blobRes.status}`, { status: 502 })
  }

  // Build response headers, copying the relevant ones from upstream so
  // Range / partial content semantics survive intact.
  const respHeaders = new Headers()
  const contentType = blobRes.headers.get('content-type') ?? letter.contentType ?? 'application/octet-stream'
  respHeaders.set('Content-Type', contentType)
  // Crucial for video — tells the browser it can request byte ranges.
  respHeaders.set('Accept-Ranges', 'bytes')
  const contentLength = blobRes.headers.get('content-length')
  if (contentLength) respHeaders.set('Content-Length', contentLength)
  const contentRange = blobRes.headers.get('content-range')
  if (contentRange) respHeaders.set('Content-Range', contentRange)
  // Suggest a download filename for non-streamable types (pdf, etc.) but
  // leave inline for media so it plays in-page.
  if (letter.fileName && !contentType.startsWith('video/') && !contentType.startsWith('audio/') && !contentType.startsWith('image/')) {
    respHeaders.set('Content-Disposition', `inline; filename="${letter.fileName.replace(/"/g, '')}"`)
  }
  // Letters are family content — keep them out of any shared cache.
  respHeaders.set('Cache-Control', 'private, max-age=300')

  return new NextResponse(blobRes.body, {
    status: blobRes.status,
    headers: respHeaders,
  })
}
