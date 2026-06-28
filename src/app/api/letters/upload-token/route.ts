import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { isAllowedRecipientSlug } from '@/lib/letters-recipients'

// Issues a one-time client-side upload token for a letter attachment so
// the browser can stream the file *directly* to Vercel Blob. Bypasses the
// 4.5 MB serverless function body limit that was hanging video uploads
// when they went through the createLetter server action.
//
// The actual letter row is written by /api/letters/save-metadata after
// the upload finishes — we don't write here, because the upload token
// flow can't pass DB writes back to the client cleanly.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'superuser') {
    return NextResponse.json({ error: 'Superusers only' }, { status: 403 })
  }

  let body: HandleUploadBody
  try {
    body = (await request.json()) as HandleUploadBody
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // clientPayload is a JSON string with { recipient } so we can scope
        // the path under the recipient slug. Validate it before issuing.
        let recipient = ''
        try {
          const parsed = JSON.parse(clientPayload ?? '{}') as { recipient?: unknown }
          if (typeof parsed.recipient === 'string') recipient = parsed.recipient.toLowerCase()
        } catch { /* fall through to empty recipient */ }
        if (!recipient || !isAllowedRecipientSlug(recipient)) {
          throw new Error('Pick a recipient before uploading.')
        }
        // Allow image / audio / video / pdf attachments. 100 MB cap is
        // generous for video letters; Vercel Blob supports larger but we
        // don't need it for this use case.
        return {
          allowedContentTypes: [
            'image/*', 'application/pdf',
            'audio/*', 'video/*',
          ],
          maximumSizeInBytes: 100 * 1024 * 1024,
          // No DB write here — the client calls saveLetterMetadata once
          // upload() resolves with the blob URL.
          tokenPayload: null,
          // Letters live in the private blob namespace. Same as the old
          // server-action put() call.
          addRandomSuffix: true,
        }
      },
      onUploadCompleted: async () => {
        // Intentionally empty — DB write happens client-side via
        // saveLetterMetadata() so the user gets a synchronous error if
        // anything's off, instead of a silently-failing webhook.
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload token failed.' },
      { status: 400 },
    )
  }
}
