'use client'

import { useState } from 'react'
import { sendInvite } from '@/lib/actions/admin'
import { Copy, Check } from 'lucide-react'

export function InviteForm({ isSuperuser }: { isSuperuser: boolean }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ inviteUrl: string; email: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const res = await sendInvite(formData)
    setLoading(false)
    if (res?.error) {
      setError(res.error)
    } else {
      const url = `${window.location.origin}${res.inviteUrl!}`
      setResult({ inviteUrl: res.inviteUrl!, email: formData.get('email') as string })
      ;(e.target as HTMLFormElement).reset()
      // Auto-copy link to clipboard
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      } catch {}
    }
  }

  function copyLink() {
    if (!result) return
    navigator.clipboard.writeText(`${window.location.origin}${result.inviteUrl}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Email Address</label>
          <input
            name="email"
            type="email"
            required
            placeholder="family@example.com"
            className="w-full px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Role</label>
          <select
            name="role"
            className="px-3 py-2.5 bg-stone-700 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="member">Member</option>
            <option value="readonly">Read-only</option>
            {isSuperuser && <option value="admin">Admin</option>}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 text-white font-medium rounded-lg transition whitespace-nowrap"
        >
          {loading ? 'Sending...' : 'Send Invite'}
        </button>
      </form>

      {error && (
        <div className="mt-3 text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-4 bg-stone-700/50 border border-stone-600/50 rounded-xl">
          <p className="text-sm text-stone-300 mb-2">
            Invite link for <span className="text-stone-100 font-medium">{result.email}</span> (valid 30 days):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-emerald-300 bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 truncate">
              {typeof window !== 'undefined' ? `${window.location.origin}${result.inviteUrl}` : result.inviteUrl}
            </code>
            <button
              onClick={copyLink}
              className="p-2 text-stone-400 hover:text-stone-200 hover:bg-stone-700 rounded-lg transition"
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
