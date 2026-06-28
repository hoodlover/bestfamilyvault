'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Lock, Check } from 'lucide-react'
import { resetPasswordWithToken } from '@/lib/actions/password-reset'

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fd = new FormData(e.currentTarget)
    fd.append('token', token)
    const res = await resetPasswordWithToken(fd)
    setBusy(false)
    if (res?.error) { setError(res.error); return }
    setDone(true)
  }

  if (!token) {
    return (
      <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <h2 className="text-lg font-semibold text-stone-100 mb-2">Bad link</h2>
        <p className="text-sm text-stone-400 leading-relaxed">
          This page needs a token in the URL. If you got here by clicking an email link
          and you&rsquo;re seeing this, the link is malformed.
        </p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition">
          Request a fresh reset link →
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/40 border border-emerald-700/60">
          <Check size={22} className="text-emerald-300" />
        </div>
        <h2 className="text-lg font-semibold text-stone-100 mb-2">Password updated</h2>
        <p className="text-sm text-stone-400 leading-relaxed">
          You&rsquo;re good to go. Use your new password to sign in.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-flex items-center justify-center px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          Sign in →
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl">
      <h2 className="text-xl font-semibold text-stone-100 mb-2">Pick a new password</h2>
      <p className="text-sm text-stone-400 mb-5">
        At least 8 characters. Pick something you&rsquo;ll actually remember — there&rsquo;s no
        secondary recovery yet.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-stone-300 mb-1.5">
            New password
          </label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              placeholder="••••••••"
            />
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-stone-300 mb-1.5">
            Confirm new password
          </label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              placeholder="••••••••"
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
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  )
}
