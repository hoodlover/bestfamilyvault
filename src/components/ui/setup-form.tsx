'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSuperuser } from '@/lib/actions/setup'
import { FEATURE_MODES } from '@/lib/feature-modes'
import { FAMILY_PRESETS } from '@/lib/family-presets'

export function SetupForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await createSuperuser(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      const mode = String(formData.get('featureMode') ?? 'simple')
      window.localStorage.setItem('bestfamilyvault.featureMode', mode)
      window.localStorage.setItem('bestfamilyvault.familyPreset', String(formData.get('familyPreset') ?? 'family-four'))
      setDone(true)
      setTimeout(() => router.push('/login'), 2000)
    }
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <div className="text-4xl mb-3">🎉</div>
        <p className="text-stone-100 font-semibold">Superuser created!</p>
        <p className="text-stone-400 text-sm mt-1">Redirecting to login...</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Full Name</label>
        <input
          name="name"
          required
          placeholder="Alex Morgan"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Email</label>
        <input
          name="email"
          type="email"
          required
          placeholder="alex@example.com"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Password</label>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          placeholder="At least 10 characters"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Confirm Password</label>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={10}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Starting mode</label>
        <select
          name="featureMode"
          defaultValue="simple"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        >
          {FEATURE_MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>{mode.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          Pick less if this is for someone who only needs profile info and planning.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Family starter</label>
        <select
          name="familyPreset"
          defaultValue="family-four"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        >
          {FAMILY_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-stone-500">
          This will drive the first-use family setup wizard as the app grows.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">
          Setup Key
          <span className="ml-1 text-xs text-stone-600">(from .env.local SETUP_KEY)</span>
        </label>
        <input
          name="setupKey"
          type="password"
          required
          placeholder="Setup key"
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
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
        className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
      >
        {loading ? 'Creating account...' : 'Create Superuser'}
      </button>
      <div className="flex flex-wrap justify-center gap-3 pt-1 text-xs text-stone-500">
        <Link href="/welcome" className="hover:text-stone-300">Welcome guide</Link>
        <Link href="/password-imports" className="hover:text-stone-300">Password imports</Link>
        <Link href="/privacy" className="hover:text-stone-300">Privacy</Link>
      </div>
    </form>
  )
}
