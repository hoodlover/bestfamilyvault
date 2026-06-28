'use server'

import { list } from '@vercel/blob'

export interface ExtensionRelease {
  version: string
  downloadUrl: string
  filename: string
  sizeBytes: number
  uploadedAt: string
}

// Returns the currently published browser-extension release, or null if
// nothing has been published yet (or the manifest fetch failed). The
// publish script writes extension/manifest.json on every release; we
// resolve it via list() so this works without any env-var wiring.
//
// Both manifest.json and the zip are uploaded with access: 'private', so
// fetches need the BLOB_READ_WRITE_TOKEN bearer header. The zip itself is
// streamed to users through /api/extension/download — never via the raw
// downloadUrl returned here.
export async function getExtensionRelease(): Promise<ExtensionRelease | null> {
  try {
    const { blobs } = await list({ prefix: 'extension/manifest.json' })
    const manifestBlob = blobs.find((b) => b.pathname === 'extension/manifest.json')
    if (!manifestBlob) return null
    const res = await fetch(manifestBlob.url, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as ExtensionRelease
    if (!data?.downloadUrl || !data?.version) return null
    return data
  } catch (err) {
    console.warn('[extension-release] manifest fetch failed:', err instanceof Error ? err.message : err)
    return null
  }
}
