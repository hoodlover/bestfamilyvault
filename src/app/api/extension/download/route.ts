import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getExtensionRelease } from '@/lib/actions/extension-release'

// Streams the latest published browser-extension zip to authenticated
// vault users. Extension zips live in Vercel Blob under access: 'private'
// so the raw blob URL alone returns 403 — this route proxies the bytes
// using BLOB_READ_WRITE_TOKEN so the Settings download card and the
// family member opening it on their new device both work.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const release = await getExtensionRelease()
  if (!release) {
    return new NextResponse('No extension build published yet.', { status: 404 })
  }

  const blobRes = await fetch(release.downloadUrl, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  })
  if (!blobRes.ok) {
    return new NextResponse(`Upstream blob fetch failed: ${blobRes.status}`, { status: 502 })
  }

  const headers = new Headers()
  headers.set('Content-Type', 'application/zip')
  headers.set('Content-Disposition', `attachment; filename="${release.filename.replace(/"/g, '')}"`)
  const len = blobRes.headers.get('content-length')
  if (len) headers.set('Content-Length', len)
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate')

  return new NextResponse(blobRes.body, { status: 200, headers })
}
