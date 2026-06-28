'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Sparkles, ArrowRight, Eye, ShieldAlert } from 'lucide-react'
import { APP_NAME } from '@/lib/branding'

const DEMO_ROLES = [
  { email: 'demo@bestfamilyvault.app', label: 'Owner', sub: 'Superuser — sees everything', recommended: true },
  { email: 'parent@bestfamilyvault.app', label: 'Parent', sub: 'Admin — manages family' },
  { email: 'kid1@bestfamilyvault.app', label: 'Kid 1', sub: 'Member — limited view' },
  { email: 'guest@bestfamilyvault.app', label: 'Guest', sub: 'Read-only — can browse, can\'t edit' },
]

const DEMO_PASSWORD = 'demo1234'

export default function DemoLandingPage() {
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-6">
        <div className="text-center text-stone-400 max-w-md">
          <ShieldAlert size={32} className="text-stone-500 mx-auto mb-3" />
          <h1 className="text-lg text-stone-200 font-semibold mb-1">Demo mode is off</h1>
          <p className="text-sm">
            This page is only available on the public demo deployment. On a
            self-hosted instance, sign in normally at <a href="/login" className="underline text-emerald-400">/login</a>.
          </p>
        </div>
      </div>
    )
  }

  async function handleSignIn(email: string) {
    setSigningIn(email)
    setError(null)
    const result = await signIn('credentials', {
      email,
      password: DEMO_PASSWORD,
      redirect: false,
    })
    if (result?.error) {
      setError('Sign-in failed — the demo DB may be resetting. Try again in a few seconds.')
      setSigningIn(null)
      return
    }
    window.location.assign('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 to-stone-900 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-950/50 border border-amber-700/50 rounded-full text-xs text-amber-300 mb-4">
            <Sparkles size={13} /> Live demo
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-stone-100 mb-2">
            {APP_NAME} — try it
          </h1>
          <p className="text-stone-400 max-w-lg mx-auto">
            A family password manager + notes + grouped credentials. Pick a role
            below and start exploring. All data is fake; the DB resets a few times a day.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {DEMO_ROLES.map((r) => (
            <button
              key={r.email}
              type="button"
              onClick={() => handleSignIn(r.email)}
              disabled={!!signingIn}
              className={`group relative flex flex-col text-left p-5 rounded-2xl border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                r.recommended
                  ? 'bg-emerald-950/30 border-emerald-700/50 hover:border-emerald-500'
                  : 'bg-stone-800/60 border-stone-700/50 hover:border-stone-500'
              }`}
            >
              {r.recommended && (
                <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wider text-emerald-300">
                  Recommended
                </span>
              )}
              <div className="text-sm font-semibold text-stone-100 mb-0.5">
                Sign in as {r.label}
              </div>
              <div className="text-xs text-stone-400 mb-3">{r.sub}</div>
              <div className="flex items-center gap-1 text-xs text-stone-500 group-hover:text-stone-300 mt-auto">
                {signingIn === r.email ? 'Signing in...' : 'Continue'}
                <ArrowRight size={12} />
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-xs text-red-300 text-center">
            {error}
          </div>
        )}

        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-5 text-xs text-stone-400 leading-relaxed">
          <div className="flex items-start gap-2">
            <Eye size={14} className="text-stone-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-stone-300 font-medium mb-1">What you&apos;ll see</p>
              <p>
                Pre-seeded categories (Streaming, Banking, Email, Shopping…),
                ~30 fake login entries, sample bank accounts and credit cards
                (test numbers only), a couple of merged credential groups
                (try the Netflix / Amazon / Gmail cards), and a few notes.
              </p>
              <p className="mt-2">
                Try <em>Search</em>, the <em>Merge</em> button on search
                results, the <em>Linked Credentials</em> view inside merged cards,
                and <em>/admin/merge-candidates</em> if you signed in as Owner.
              </p>
              <p className="mt-2 text-amber-300">
                ⚠️ Don&apos;t enter real passwords. The DB is shared with everyone
                visiting the demo and gets wiped on a schedule.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
