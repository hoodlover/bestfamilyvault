'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Globe, Lock, Star, Eye, Check, X, ChevronDown, ChevronUp, Plus, UserRound } from 'lucide-react'
import { clsx } from 'clsx'
import { removeFromGroup, addCredentialToGroup, deleteEntry } from '@/lib/actions/entries'
import { prettyHost } from '@/lib/format-url'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>

interface Props {
  parent: Entry
  childEntries: Entry[]
  canEdit?: boolean
}

export function GroupedEntryCard({ parent, childEntries, canEdit = true }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const allCredentials = [parent, ...childEntries]

  async function handleReveal(entry: Entry) {
    const val = entry.password || null
    if (!val) return
    try { await navigator.clipboard.writeText(val) } catch {}
    setCopiedId(entry.id)
    setRevealedId(entry.id)
    setTimeout(() => { setCopiedId(null); setRevealedId(null) }, 3000)
  }

  function handleRemove(childId: string) {
    startTransition(async () => {
      await removeFromGroup(childId)
      router.refresh()
    })
  }

  function handleDeleteChild(childId: string) {
    if (confirmDeleteId !== childId) {
      setConfirmDeleteId(childId)
      return
    }
    startTransition(async () => {
      await deleteEntry(childId)
      setConfirmDeleteId(null)
      router.refresh()
    })
  }

  function handleAddCredential() {
    if (!newUsername && !newPassword) return
    startTransition(async () => {
      await addCredentialToGroup(parent.id, newUsername, newPassword)
      setNewUsername('')
      setNewPassword('')
      setShowAddForm(false)
      router.refresh()
    })
  }

  return (
    <div className={clsx(
      'flex flex-col rounded-xl border transition',
      'bg-stone-800/60 border-stone-700/50 hover:border-stone-600'
    )}>
      {/* Parent header — always visible */}
      <Link href={`/entries/${parent.id}`} className="flex flex-col p-4 pb-2">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={15} className="shrink-0 text-blue-400" />
            <span className="text-xs font-medium text-stone-500">Login</span>
            {parent.isPrivate && <Lock size={11} className="text-emerald-600 shrink-0" />}
            {parent.isPersonal && <UserRound size={11} className="text-amber-400 shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-emerald-500 bg-emerald-950/50 border border-emerald-800/40 px-1.5 py-0.5 rounded-full">
              {allCredentials.length} accounts
            </span>
            {parent.isFavorite && <Star size={14} className="text-[#d8a531] fill-[#d8a531]" />}
          </div>
        </div>
        <h3 className="text-sm font-semibold text-stone-200 truncate">{parent.title}</h3>
        {parent.url && (
          // Hostname-only on the card (full URL on the detail page).
          <p className="text-xs text-stone-500 mt-1 truncate" title={parent.url}>{prettyHost(parent.url)}</p>
        )}
      </Link>

      {/* Footer with expand toggle + edit */}
      <div className="flex items-center justify-between px-4 pb-3 pt-1 gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 transition"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Hide accounts' : 'Show accounts'}
        </button>
        {canEdit && (
          <Link
            href={`/entries/${parent.id}/edit`}
            onClick={(e) => e.stopPropagation()}
            className="p-1 text-stone-600 hover:text-stone-300 transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </Link>
        )}
      </div>

      {/* Expanded credential list */}
      {expanded && (
        <div className="border-t border-stone-700/50 px-4 py-3 space-y-2">
          {allCredentials.map((cred) => (
            <div key={cred.id} className="flex items-center gap-2 py-1.5 border-b border-stone-800/60 last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-stone-300 truncate">{cred.username || <span className="text-stone-600">no username</span>}</p>
                {revealedId === cred.id && cred.password && (
                  <p className="text-xs text-emerald-300 font-mono truncate mt-0.5">{cred.password}</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {cred.password && (
                  <button
                    type="button"
                    onClick={() => handleReveal(cred)}
                    title={copiedId === cred.id ? 'Copied!' : 'Reveal & copy password'}
                    className={clsx(
                      'p-1 rounded transition',
                      copiedId === cred.id ? 'text-emerald-400' : 'text-stone-500 hover:text-stone-300'
                    )}
                  >
                    {copiedId === cred.id ? <Check size={13} /> : <Eye size={13} />}
                  </button>
                )}

                {canEdit && cred.id !== parent.id && (
                  <button
                    type="button"
                    onClick={() => handleRemove(cred.id)}
                    title="Remove from group (keep entry)"
                    className="p-1 text-stone-600 hover:text-stone-400 transition text-xs"
                    disabled={isPending}
                  >
                    ↗
                  </button>
                )}

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDeleteChild(cred.id)}
                    title={confirmDeleteId === cred.id ? 'Click again to confirm' : 'Delete credential'}
                    className={clsx(
                      'rounded transition text-xs',
                      confirmDeleteId === cred.id
                        ? 'px-1.5 py-0.5 bg-red-700 text-white'
                        : 'p-1 text-stone-600 hover:text-red-400'
                    )}
                  >
                    {confirmDeleteId === cred.id ? 'Sure?' : <X size={12} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add credential */}
          {canEdit && (
            showAddForm ? (
              <div className="pt-2 space-y-2">
                <input
                  type="text"
                  placeholder="Username / email"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-stone-900 border border-stone-700 rounded-lg text-stone-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                />
                <input
                  type="text"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-stone-900 border border-stone-700 rounded-lg text-stone-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAddCredential}
                    disabled={isPending || (!newUsername && !newPassword)}
                    className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-700 disabled:text-stone-500 text-white text-xs font-medium rounded-lg transition"
                  >
                    {isPending ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAddForm(false); setNewUsername(''); setNewPassword('') }}
                    className="px-3 py-1.5 text-stone-400 hover:text-stone-200 text-xs transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-emerald-400 transition pt-1"
              >
                <Plus size={12} />
                Add account
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
