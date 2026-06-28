import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { headers } from 'next/headers'
import { db, getDb } from '@/lib/db'
import { users, accounts, sessions, verificationTokens } from '@/lib/db/schema'
import { getClientIp } from '@/lib/get-client-ip'
import {
  shouldThrottleLogin,
  recordLoginAttempt,
  maybeNotifyNewDevice,
  tarpit,
} from '@/lib/rate-limit'

// Auth.js v5 reads AUTH_SECRET by default, but historic deployments may only
// have NEXTAUTH_SECRET set (the v4 name). Read both so renaming the env var
// can't silently break sign-in. Pass directly to the config rather than
// relying on env-var auto-detection so this is robust across versions.
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        // Honeypot — hidden in the form, real users never touch it.
        // Auth.js needs the field listed here to pass it through to
        // authorize() with the rest of credentials.
        website: { label: 'Website', type: 'text' },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null

          const email = credentials.email as string

          // Honeypot — the login form ships an invisible <input
          // name="website">. Real users never fill it; bots usually do.
          // If it's populated, tarpit and reject without ever hitting
          // bcrypt or the DB.
          if (typeof credentials.website === 'string' && credentials.website.trim() !== '') {
            await tarpit()
            return null
          }

          // Capture the request's IP + UA via next/headers — works inside
          // authorize() because Auth.js runs it in request context within
          // the App Router. Fall back to "unknown" if the headers helper
          // throws (it can during static analysis); we still want login
          // to work even when the rate-limit signal is degraded.
          let ip = 'unknown'
          let userAgent: string | null = null
          try {
            const hdrs = await headers()
            ip = getClientIp(hdrs)
            userAgent = hdrs.get('user-agent')
          } catch {
            // Headers unavailable — record the attempt under "unknown" IP
            // so it still gets logged.
          }

          // Throttle first — never reveal the throttle to the attacker.
          // Tarpit + generic null reject; looks identical to wrong password.
          const throttled = await shouldThrottleLogin({ ip, email })
          if (throttled) {
            await tarpit()
            await recordLoginAttempt({ ip, email, succeeded: false, userAgent })
            return null
          }

          // Explicit column list — selecting * blows up if a schema-pending
          // column (date_of_birth, voice_memo_blob_url, etc.) hasn't been
          // pushed to prod yet, which surfaces as a generic "Invalid email
          // or password" because NextAuth swallows the throw. Pick only what
          // we actually need so login works regardless of pending migrations.
          const user = await db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
              image: users.image,
              passwordHash: users.passwordHash,
            })
            .from(users)
            .where(eq(users.email, email))
            .then((r) => r[0] ?? null)

          if (!user?.passwordHash) {
            await tarpit()
            await recordLoginAttempt({ ip, email, succeeded: false, userAgent })
            return null
          }

          const valid = await bcrypt.compare(
            credentials.password as string,
            user.passwordHash
          )
          if (!valid) {
            await tarpit()
            await recordLoginAttempt({ ip, email, succeeded: false, userAgent })
            return null
          }

          // Success — record it, then maybe send a new-device alert.
          // Both are fire-and-forget enough that we await them but their
          // implementations never throw. Sequence matters: record first so
          // maybeNotifyNewDevice's "has this IP succeeded before?" query
          // counts the current attempt and can correctly identify the
          // first-ever sign-in (no email then).
          await recordLoginAttempt({ ip, email, succeeded: true, userAgent })
          await maybeNotifyNewDevice({ email, ip, userAgent })

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            image: user.image,
          }
        } catch (err) {
          // Surface the real exception in Vercel logs. Without this, Auth.js
          // wraps any throw as a generic CallbackRouteError and you can't tell
          // a DB connection failure from a bcrypt issue from a config bug.
          console.error('[auth] authorize() threw:', err)
          throw err
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.picture = user.image ?? null
      }
      // Allow client-side `update({ image })` to refresh the avatar without re-login
      if (trigger === 'update' && session?.user?.image !== undefined) {
        token.picture = session.user.image
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.image = (token.picture as string | null) ?? null
      }
      return session
    },
  },
})
