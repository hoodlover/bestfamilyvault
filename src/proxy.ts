import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  // Public paths — always allow. /demo is the role-picker landing for the
  // public demo deployment; it auto-signs the visitor in via signIn() so it
  // must be reachable while logged out.
  // /offline is intentionally public so the static-shell page is reachable
  // both online (for cache-seeding) and offline (when the SW serves it from
  // cache). The page itself contains zero server-rendered data — actual vault
  // content lives in the user's IndexedDB, encrypted with their local PIN.
  const publicPaths = ['/login', '/register', '/invite', '/setup', '/demo', '/offline', '/forgot-password', '/reset-password']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  if (!session && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Private Vault — superuser only
  if (pathname.startsWith('/vault') && session?.user?.role !== 'superuser') {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  // Admin — superuser or admin only
  if (
    pathname.startsWith('/admin') &&
    session?.user?.role !== 'superuser' &&
    session?.user?.role !== 'admin'
  ) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons).*)'],
}
