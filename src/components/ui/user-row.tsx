'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateUserRole, resetUserPassword, deleteUser } from '@/lib/actions/admin'
import { clsx } from 'clsx'

const roleBadge: Record<string, string> = {
  superuser: 'bg-emerald-950/40 text-emerald-400 border-emerald-900/50',
  admin: 'bg-purple-900/40 text-purple-400 border-purple-800/50',
  member: 'bg-blue-900/40 text-blue-400 border-blue-800/50',
  readonly: 'bg-stone-700/40 text-stone-400 border-stone-600/50',
}

interface UserRowProps {
  user: {
    id: string
    name: string | null
    email: string | null
    role: string
    createdAt: Date
  }
  currentUserId: string
  isSuperuser: boolean
}

export function UserRow({ user, currentUserId, isSuperuser }: UserRowProps) {
  const router = useRouter()
  const [resetting, setResetting] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [roleLoading, setRoleLoading] = useState(false)

  const isSelf = user.id === currentUserId
  const canManage = !isSelf && isSuperuser && user.role !== 'superuser'

  async function handleRoleChange(role: 'admin' | 'member' | 'readonly') {
    setRoleLoading(true)
    await updateUserRole(user.id, role)
    setRoleLoading(false)
    router.refresh()
  }

  async function handlePasswordReset() {
    if (!newPw) return
    const result = await resetUserPassword(user.id, newPw)
    if (result?.error) {
      setPwError(result.error)
    } else {
      setPwSuccess(true)
      setResetting(false)
      setNewPw('')
      setTimeout(() => setPwSuccess(false), 3000)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${user.name ?? user.email}? This cannot be undone.`)) return
    await deleteUser(user.id)
    router.refresh()
  }

  return (
    <div className="border-b border-stone-700/30 last:border-0 px-4 py-3.5">
      {/* Top row: name, role badge, joined */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm font-medium text-stone-200 truncate">{user.name ?? '—'}</span>
          {isSelf && <span className="text-xs text-stone-600">(you)</span>}
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border capitalize shrink-0', roleBadge[user.role])}>
            {user.role}
          </span>
        </div>
        <span className="text-xs text-stone-600 shrink-0 mt-0.5">
          {new Date(user.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Email */}
      <p className="text-xs text-stone-500 mb-2 truncate">{user.email}</p>

      {/* Actions */}
      {canManage && (
        <div className="flex items-center flex-wrap gap-2 mt-2">
          {/* Role change */}
          <select
            onChange={(e) => handleRoleChange(e.target.value as 'admin' | 'member' | 'readonly')}
            value={user.role}
            disabled={roleLoading}
            className="text-xs bg-stone-700 border border-stone-600 text-stone-300 rounded-lg px-2 py-1.5 focus:outline-none"
          >
            <option value="admin">admin</option>
            <option value="member">member</option>
            <option value="readonly">readonly</option>
          </select>

          {/* Reset password */}
          {!resetting ? (
            <button
              onClick={() => setResetting(true)}
              className="text-xs text-stone-500 hover:text-stone-300 transition px-2 py-1.5 rounded-lg hover:bg-stone-700 border border-stone-700"
            >
              Reset PW
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePasswordReset() }}
                placeholder="New password"
                className="text-xs bg-stone-700 border border-stone-600 text-stone-300 rounded-lg px-2 py-1.5 w-28 focus:outline-none"
              />
              <button
                onClick={handlePasswordReset}
                className="text-xs bg-emerald-800 hover:bg-emerald-700 text-white rounded-lg px-2 py-1.5 transition"
              >
                Set
              </button>
              <button
                onClick={() => setResetting(false)}
                className="text-xs text-stone-500 hover:text-stone-300 transition px-1"
              >
                ✕
              </button>
            </div>
          )}

          {pwSuccess && <span className="text-xs text-green-400">Password reset!</span>}
          {pwError && <span className="text-xs text-red-400">{pwError}</span>}

          {/* Delete */}
          <button
            onClick={handleDelete}
            className="text-xs text-stone-600 hover:text-red-400 transition px-2 py-1.5 rounded-lg hover:bg-stone-700 border border-stone-700"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
