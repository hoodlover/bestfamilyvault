import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.66'],
  // File uploads (photos for assets / receipts / IDs, recipe images,
  // letters with attachments) go through the uploadFile server action.
  // Next.js's default serverActions.bodySizeLimit is 1MB; the v268
  // JPEG quality bump (0.85 → 0.92) pushed some asset photos over that
  // cap and broke their upload. 10mb gives plenty of margin for the
  // recompressed 2400px JPEG plus FormData overhead, while still
  // sitting comfortably under Vercel's platform request body cap.
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // SAMEORIGIN (not DENY) so the in-app PDF preview modal can
          // iframe /api/files/[id]?preview=1 from our own origin. DENY
          // blocked it on desktop ("refused to connect") and rendered
          // blank on mobile. SAMEORIGIN keeps clickjacking protection
          // for any external embedder while letting us frame our own.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig
