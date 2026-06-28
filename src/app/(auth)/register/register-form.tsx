'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { registerWithInvite } from '@/lib/actions/auth'
import { APP_NAME } from '@/lib/branding'

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await registerWithInvite(formData)

    setLoading(false)

    if (result?.error) {
      setError(result.error)
    } else {
      router.push('/login?registered=1')
    }
  }

  if (!token) {
    return (
      <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-8 shadow-2xl text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h2 className="text-xl font-semibold text-stone-100 mb-2">Invite Required</h2>
        <p className="text-stone-400 text-sm">
          {APP_NAME} is invite-only. Ask a family member for an invite link.
        </p>
        <Link href="/login" className="mt-4 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl">
      <h2 className="text-xl font-semibold text-stone-100 mb-1">Create your account</h2>
      <p className="text-stone-400 text-sm mb-6">You&apos;ve been invited to join the family vault.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-stone-300 mb-1.5">
            Full Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            placeholder="Your name"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1.5">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            placeholder="At least 10 characters"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-stone-300 mb-1.5">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white font-medium rounded-lg transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 focus:ring-offset-stone-900"
        >
          {loading ? 'Creating account...' : 'Join the Vault'}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-stone-500">
        Already have an account?{' '}
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300 transition">
          Sign in
        </Link>
      </p>
    </div>
  )
}
