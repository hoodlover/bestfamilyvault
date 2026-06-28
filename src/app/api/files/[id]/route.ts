import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { files, entries, notes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // ?preview=1 → serve with Content-Disposition: inline so the browser renders
  // the file in <img> / <iframe> / <video> instead of forcing a download.
  // Default (no query) still downloads, preserving existing behavior.
  const preview = req.nextUrl.searchParams.get('preview') === '1'

  const { id } = await params
  const file = await db.select().from(files).where(eq(files.id, id)).then((r) => r[0])

  if (!file) return new NextResponse('Not found', { status: 404 })

  const isSuperuser = session.user.role === 'superuser'

  if (file.isPrivate && !isSuperuser) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Inherit visibility from parent entry/note: a personal entry's attachment
  // shouldn't be downloadable by other family members just by guessing the URL.
  if (file.entryId) {
    const parent = await db
      .select({ isPrivate: entries.isPrivate, isPersonal: entries.isPersonal, createdBy: entries.createdBy })
      .from(entries)
      .where(eq(entries.id, file.entryId))
      .then((r) => r[0])
    if (parent?.isPrivate && !isSuperuser) return new NextResponse('Forbidden', { status: 403 })
    // isPersonal is strictly owner-only — superuser does not bypass.
    if (parent?.isPersonal && parent.createdBy !== session.user.id) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  } else if (file.noteId) {
    const parent = await db
      .select({ isPrivate: notes.isPrivate, isPersonal: notes.isPersonal, createdBy: notes.createdBy })
      .from(notes)
      .where(eq(notes.id, file.noteId))
      .then((r) => r[0])
    if (parent?.isPrivate && !isSuperuser) return new NextResponse('Forbidden', { status: 403 })
    // isPersonal is strictly owner-only — superuser does not bypass.
    if (parent?.isPersonal && parent.createdBy !== session.user.id) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const blobRes = await fetch(file.blobUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })

  if (!blobRes.ok) {
    return new NextResponse('Failed to fetch file', { status: 502 })
  }

  // Quote-escape the filename so files with quotes in the name don't break
  // the Content-Disposition header parser.
  const safeName = file.filename.replace(/"/g, '\\"')

  // Apply stored display rotation for images (0/90/180/270). The bytes on
  // disk are untouched; we re-encode on serve so the eyeball preview, the
  // /cards thumbnail, and a download all see the same orientation. PDFs
  // and videos skip this path entirely — their orientation isn't a single
  // image rotation.
  const rotation = ((file.rotation ?? 0) % 360 + 360) % 360
  if (rotation !== 0 && file.contentType.startsWith('image/')) {
    try {
      const sharp = (await import('sharp')).default
      const inputBuf = Buffer.from(await blobRes.arrayBuffer())
      const outBuf = await sharp(inputBuf).rotate(rotation).toBuffer()
      return new NextResponse(new Uint8Array(outBuf), {
        headers: {
          'Content-Type': file.contentType,
          'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="${safeName}"`,
          'Cache-Control': 'private, no-cache',
        },
      })
    } catch (err) {
      console.warn('[api/files] rotation failed, serving original:', err instanceof Error ? err.message : err)
      // Fall through to the unrotated response. Don't fail the whole
      // request just because we couldn't transform — user still gets
      // their file, just sideways.
    }
  }

  return new NextResponse(blobRes.body, {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="${safeName}"`,
      'Cache-Control': 'private, no-cache',
    },
  })
}
