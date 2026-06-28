import type { MetadataRoute } from 'next'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding'

// Web Share Target — registers the installed PWA as a destination in
// Android's Share sheet. Any file (photo, PDF, screenshot, document)
// shared from Gallery / Files / Drive / camera / email lands as a
// multipart POST at /inbox/share, which queues it into the unsorted
// "drop folder" at /inbox. Next.js's MetadataRoute.Manifest type
// doesn't include share_target yet, so we attach it via spread + cast.
const shareTarget = {
  share_target: {
    action: '/inbox/share',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [
        {
          name: 'files',
          // Wide-open accept so the share sheet shows the vault for
          // every file type. The route handler does its own filtering
          // if we ever need to gate (today: nothing is gated — Lance
          // wants any file droppable).
          accept: ['image/*', 'application/pdf', 'video/*', 'audio/*', 'text/*', '*/*'],
        },
      ],
    },
  },
}

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_TAGLINE,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#1c1917',
    theme_color: '#1c1917',
    orientation: 'portrait',
    categories: ['productivity', 'utilities'],
    // Register each size with both `any` and `maskable` purposes so Android
    // doesn't wrap the icon in a white circle on the home screen. The
    // artwork is the family centered in front of the vault door, flattened
    // on black so any cropping Android does survives without white edges.
    // (Next.js's MetadataRoute.Manifest type doesn't accept the combined
    // `'any maskable'` string, so we register two entries per size.)
    icons: [
      { src: '/icons/cobb/cf-pwa-192.png',  sizes: '192x192',  type: 'image/png', purpose: 'any' },
      { src: '/icons/cobb/cf-pwa-192.png',  sizes: '192x192',  type: 'image/png', purpose: 'maskable' },
      { src: '/icons/cobb/cf-pwa-384.png',  sizes: '384x384',  type: 'image/png', purpose: 'any' },
      { src: '/icons/cobb/cf-pwa-512.png',  sizes: '512x512',  type: 'image/png', purpose: 'any' },
      { src: '/icons/cobb/cf-pwa-512.png',  sizes: '512x512',  type: 'image/png', purpose: 'maskable' },
      { src: '/icons/cobb/cf-pwa-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    ],
    shortcuts: [
      {
        name: 'Inbox',
        url: '/inbox',
        description: 'Drop folder for unsorted files',
      },
      {
        name: 'New Entry',
        url: '/entries/new',
        description: 'Add a new vault entry',
      },
      {
        name: 'Search',
        url: '/search',
        description: 'Search the vault',
      },
    ],
    ...(shareTarget as object),
  }
}
