'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail, Check } from 'lucide-react'
import { requestPasswordReset } from '@/lib/actions/password-reset'

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fd = new FormData(e.currentTarget)
    const res = await requestPasswordReset(fd)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/40 border border-emerald-700/60">
          <Check size={22} className="text-emerald-300" />
        </div>
        <h2 className="text-lg font-semibold text-stone-100 mb-2">Check your email</h2>
        <p className="text-sm text-stone-400 leading-relaxed">
          If that email is in our system, we sent a link. It works once and expires in an hour. Check spam if it doesn&rsquo;t show up in a minute or two.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition"
        >
          ← Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl">
      <h2 className="text-xl font-semibold text-stone-100 mb-2">Forgot your password?</h2>
      <p className="text-sm text-stone-400 mb-5">
        Type the email you sign in with. We&rsquo;ll send a link to set a new password.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1.5">
            Email
          </label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              placeholder="you@example.com"
            />
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
        >
          {busy ? 'Sending…' : 'Send the link'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-stone-500">
        <Link href="/login" className="text-stone-400 hover:text-stone-200 transition">
          ← Back to sign in
        </Link>
      </p>
    </div>
  )
}
