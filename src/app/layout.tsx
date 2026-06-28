import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { eq } from 'drizzle-orm'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/ui/sw-register'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'

const VALID_THEMES = new Set(['forest', 'crimson', 'midnight', 'harvest'])
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: APP_NAME,
  description: APP_TAGLINE,
  manifest: '/manifest.webmanifest',
  // Family vault — not for public consumption. Belt + suspenders with
  // public/robots.txt: this emits <meta name="robots" content="noindex,
  // nofollow, nocache"> so even a crawler that ignores robots.txt picks
  // up the directive once it fetches a page. Already-indexed pages need
  // a Google Search Console "Remove URLs" request separately; this just
  // stops future indexing.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  openGraph: {
    title: APP_NAME,
    description: APP_TAGLINE,
    type: 'website',
    images: [
      {
        url: '/og-card.png',
        width: 1200,
        height: 630,
        alt: `${APP_NAME} social preview`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: APP_TAGLINE,
    images: ['/og-card.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_SHORT_NAME,
    // startupImage was cfv-splash.png which Lance deleted — the in-app
    // WelcomeSplash component now rotates splash1/2/3 randomly per session.
  },
  icons: {
    icon: [
      // Favicon set, derived from favicon.png. /favicon.ico at the public
      // root is the legacy fallback for older browser tabs; modern browsers
      // prefer the PNG variants here.
      { url: '/icons/cobb/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/cobb/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/cobb/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/cobb/favicon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/cobb/favicon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/cobb/favicon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      // Fully-opaque (flattened on black) PWA artwork. iOS masks the icon
      // with its own rounded shape; transparent corners would show the
      // default white background through them as a frame.
      { url: '/icons/cobb/cf-pwa-apple-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: '#1c1917',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Look up the signed-in user's accent theme so the html element can
  // carry data-theme="…" before the page paints. Unauthed routes fall
  // through to 'forest' (the :root default in globals.css already wins
  // when the attribute is absent, so this is mostly belt + suspenders).
  // Defensive: if the column was just added and an old row still has
  // NULL or a typo'd value, default safely.
  let themeAccent: string = 'forest'
  try {
    const session = await auth()
    const uid = session?.user?.id
    if (uid) {
      const row = await db
        .select({ theme: users.themeAccent })
        .from(users)
        .where(eq(users.id, uid))
        .then((r) => r[0])
      const t = row?.theme
      if (t && VALID_THEMES.has(t)) themeAccent = t
    }
  } catch {
    // DB unreachable / migration not run — just stay on forest.
  }

  return (
    <html
      lang="en"
      data-theme={themeAccent}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-stone-100">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
