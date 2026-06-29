'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await signIn('credentials', {
      email: formData.get('email'),
      password: formData.get('password'),
      // Honeypot — hidden input, real users leave it empty. Forwarded
      // verbatim so authorize() can tarpit-and-reject if a bot filled it.
      website: formData.get('website') ?? '',
      redirect: false,
    })

    setLoading(false)

    if (result?.error) {
      setError('Invalid email or password. Try again.')
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="bg-stone-900/80 backdrop-blur border border-stone-700/50 rounded-2xl p-6 sm:p-8 shadow-2xl">
      <div className="mb-5 overflow-hidden rounded-xl border border-emerald-500/20 bg-stone-950/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bestfamvault.png"
          alt="Best Family Vault"
          width={1728}
          height={922}
          className="block h-auto w-full object-cover"
        />
      </div>

      <Link
        href="/onboarding"
        className="group mb-5 grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-950/25 p-3 transition hover:border-emerald-400/50 hover:bg-emerald-950/40"
      >
        <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-emerald-400/20 bg-stone-950/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/vaultlogo.png"
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 object-contain"
          />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-emerald-300">
            <Sparkles size={13} />
            New vault
          </span>
          <span className="mt-1 block text-sm font-semibold text-stone-100">
            Create Your Best Family Vault
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-stone-400">
            Guided setup for imports, people, documents, and first steps.
          </span>
        </span>
        <ArrowRight size={18} className="text-emerald-300 transition group-hover:translate-x-0.5" />
      </Link>

      {process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && (
        <Link
          href="/demo"
          className="block mb-4 p-3 bg-amber-950/40 border border-amber-700/50 rounded-xl text-center transition hover:bg-amber-950/60"
        >
          <p className="text-sm font-medium text-amber-200">Just want to look around?</p>
          <p className="text-xs text-amber-300/80 mt-0.5">Try the demo (no signup) →</p>
        </Link>
      )}
      <h2 className="text-xl font-semibold text-stone-100 mb-6">Sign in to the vault</h2>

      <form method="post" onSubmit={handleSubmit} className="space-y-4">
        {/* Honeypot — invisible to humans, irresistible to bots.
            Positioned off-screen rather than display:none (some bots
            skip display:none); aria-hidden so screen readers don't
            announce it; tabIndex={-1} so keyboard users can't land on
            it accidentally. The authorize() callback tarpits + rejects
            any submission where this is non-empty. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          defaultValue=""
        />
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1.5">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-stone-300">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-stone-500 hover:text-emerald-300 transition"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              className="w-full px-3 py-2.5 pr-11 bg-stone-800 border border-stone-600 rounded-lg text-base text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-stone-500 hover:text-stone-200 transition focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          aria-label={loading ? 'Unlocking…' : 'Enter the Vault'}
          className="block w-full transition hover:opacity-90 active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 focus:ring-offset-stone-900 rounded-lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/enter.png"
            alt=""
            width={1728}
            height={922}
            // pointer-events-none so the <button> always gets the click —
            // on iOS the image was absorbing taps and the form never submitted.
            className={`block h-auto w-full max-h-20 object-cover object-center pointer-events-none ${loading ? 'animate-pulse' : ''}`}
          />
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-stone-500">
        Have an invite?{' '}
        <Link href="/register" className="text-emerald-400 hover:text-emerald-300 transition">
          Create your account
        </Link>
      </p>
    </div>
  )
}
