'use client'

import { useState } from 'react'
import { changePassword } from '@/lib/actions/settings'

export function ChangePasswordForm() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await changePassword(formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      setSuccess(true)
      ;(e.target as HTMLFormElement).reset()
      setTimeout(() => setSuccess(false), 4000)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Current Password</label>
        <input
          name="currentPassword"
          type="password"
          required
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">New Password</label>
        <input
          name="newPassword"
          type="password"
          required
          minLength={8}
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Confirm New Password</label>
        <input
          name="confirmPassword"
          type="password"
          required
          className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">
          Password changed successfully.
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="py-2 px-5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white text-sm font-medium rounded-lg transition"
      >
        {loading ? 'Updating...' : 'Change Password'}
      </button>
    </form>
  )
}
