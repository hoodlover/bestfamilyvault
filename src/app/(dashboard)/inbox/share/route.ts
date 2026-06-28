// Web Share Target landing route. Android's Share sheet POSTs here when
// the user picks the installed PWA as a share destination. We pull the
// multipart files out, run them through the same uploadFile() pipeline
// every other in-app upload uses (no entryId / noteId / categoryId — the
// rows land "orphaned" and surface on /inbox), then 303-redirect to the
// inbox page so the user immediately sees what landed.
//
// Auth: relies on the PWA's existing cookie session. If the user isn't
// signed in (rare — PWAs share cookies with the browser) we redirect to
// /login. We never silently accept files for an unauthenticated session.

import { NextResponse, type NextRequest } from 'next/server'
import { put } from '@vercel/blob'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { files } from '@/lib/db/schema'

export const runtime = 'nodejs'

// Vercel platform request body cap (≈4.5MB on hobby/standard). The
// share sheet honors this and rejects huge files at the OS layer, but
// guard server-side too just in case.
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024 // 25MB

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (session.user.role === 'readonly') {
    return NextResponse.redirect(new URL('/inbox?err=readonly', req.url))
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.redirect(new URL('/inbox?err=parse', req.url))
  }

  // The manifest declares `files` as the field name. Some implementations
  // (older Android, some browsers) also POST title / text / url params
  // which we ignore for the drop-folder use case — the file is what we
  // care about.
  const shared = formData.getAll('files').filter((v): v is File => v instanceof File)
  if (shared.length === 0) {
    return NextResponse.redirect(new URL('/inbox?err=nofile', req.url))
  }

  let savedCount = 0
  let oversizeCount = 0
  for (const file of shared) {
    if (file.size === 0) continue
    if (file.size > MAX_BYTES_PER_FILE) {
      oversizeCount++
      continue
    }
    try {
      // Drop folder files keep the original filename verbatim — no
      // deriveAutoFilename slug rewrite because there's no parent
      // entry/note to suffix off of yet. When Lance later sorts an
      // inbox row onto an entry, that's when the file gets renamed.
      const blob = await put(
        `vault/${session.user.id}/inbox/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
        file,
        { access: 'private', contentType: file.type || 'application/octet-stream' },
      )
      await db.insert(files).values({
        // null entryId/noteId/categoryId = "in the inbox"
        entryId: null,
        noteId: null,
        categoryId: null,
        filename: file.name,
        blobUrl: blob.url,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        isPrivate: false,
        uploadedBy: session.user.id,
      })
      savedCount++
    } catch (err) {
      console.error('[inbox/share] save failed:', err)
    }
  }

  const params = new URLSearchParams()
  if (savedCount > 0) params.set('ok', String(savedCount))
  if (oversizeCount > 0) params.set('oversize', String(oversizeCount))
  const dest = `/inbox${params.toString() ? `?${params.toString()}` : ''}`
  // 303 so the browser switches POST → GET on the redirect target.
  return NextResponse.redirect(new URL(dest, req.url), 303)
}

// GET on this same path lands a curious user on the inbox so the URL
// isn't an error page if they bookmark it by accident.
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/inbox', req.url))
}
