'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, Check, X, Plus, ArrowUpRight, Star, Copy, Pencil } from 'lucide-react'
import { clsx } from 'clsx'
import { addCredentialToGroup, removeFromGroup, deleteEntry, mergeEntries, updateLinkedCredential } from '@/lib/actions/entries'
import { LinkifiedText } from '@/components/ui/linkified-text'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>

interface Props {
  parent: Entry
  childEntries: Entry[]
  canEdit: boolean
}

export function LinkedCredentials({ parent, childEntries, canEdit }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [showAdd, setShowAdd] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newNote, setNewNote] = useState('')

  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null) // `${id}:user` | `${id}:pass`
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  // Inline edit state — keyed by entry id. When non-null for an id, that
  // row renders an editable form instead of read-only fields.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<{ title: string; url: string; username: string; password: string; noteContent: string }>({
    title: '', url: '', username: '', password: '', noteContent: '',
  })

  function startEdit(cred: Entry) {
    setEditingId(cred.id)
    setEditFields({
      title: cred.title ?? '',
      url: cred.url ?? '',
      username: cred.username ?? '',
      password: cred.password ?? '',
      noteContent: cred.noteContent ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  function saveEdit() {
    if (!editingId) return
    const id = editingId
    const fields = editFields
    startTransition(async () => {
      await updateLinkedCredential(id, fields)
      setEditingId(null)
      router.refresh()
    })
  }

  // include parent + children as one unified list
  const all: Entry[] = [parent, ...childEntries]

  async function copyToClipboard(text: string, fieldKey: string) {
    if (!text) return
    try { await navigator.clipboard.writeText(text) } catch {}
    setCopiedField(fieldKey)
    setTimeout(() => setCopiedField(null), 2000)
  }

  function toggleReveal(id: string) {
    setRevealedId((prev) => (prev === id ? null : id))
  }

  function handleAdd() {
    if (!newUsername && !newPassword) return
    startTransition(async () => {
      await addCredentialToGroup(parent.id, newUsername, newPassword, newNote)
      setNewUsername(''); setNewPassword(''); setNewNote(''); setShowAdd(false)
      router.refresh()
    })
  }

  function handleRemove(childId: string) {
    if (confirmRemoveId !== childId) {
      setConfirmRemoveId(childId)
      return
    }
    startTransition(async () => {
      await deleteEntry(childId)
      setConfirmRemoveId(null)
      router.refresh()
    })
  }

  function handleUnlink(childId: string) {
    startTransition(async () => {
      await removeFromGroup(childId)
      router.refresh()
    })
  }

  function handlePromote(childId: string) {
    // Make this child the new master. Re-merge with the new master.
    const allIds = all.map((e) => e.id)
    startTransition(async () => {
      await mergeEntries(allIds, childId)
      router.refresh()
    })
  }

  return (
    <div className="bg-stone-800/60 border border-stone-700/50 rounded-2xl p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-stone-300 uppercase tracking-wider">
          Linked Credentials ({all.length})
        </h2>
        {canEdit && !showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
          >
            <Plus size={13} /> Add credential
          </button>
        )}
      </div>

      {/* List */}
      <div className="space-y-2">
        {all.map((cred) => {
          const isMaster = cred.id === parent.id
          const isRevealed = revealedId === cred.id
          return (
            <div
              key={cred.id}
              className={clsx(
                'rounded-xl border transition',
                isMaster
                  ? 'bg-emerald-950/30 border-emerald-800/50'
                  : 'bg-stone-900/40 border-stone-700/40'
              )}
            >
              <div className="p-3 space-y-1.5">
                {/* Header: master badge + title + url + edit toggle. Without
                    title/url, a merged credential is just an anonymous
                    user/pass pair with no way to tell which site or family
                    member it belongs to. */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex-1 min-w-0">
                    {isMaster ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-0.5">
                        <Star size={11} className="fill-emerald-400" /> Master
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500 mb-0.5">
                        Linked credential
                      </span>
                    )}
                    <p className={clsx('text-sm font-medium break-words', isMaster ? 'text-emerald-100' : 'text-stone-200')}>
                      {cred.title}
                    </p>
                    {cred.url && cred.url !== parent.url && (
                      <p className="text-[11px] mt-0.5 break-all">
                        <a
                          href={cred.url.startsWith('http') ? cred.url : `https://${cred.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-700 hover:decoration-emerald-500 underline-offset-2"
                          title={cred.url}
                        >
                          {cred.url.replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 48)}
                          {cred.url.replace(/^https?:\/\//, '').replace(/^www\./, '').length > 48 ? '…' : ''}
                        </a>
                      </p>
                    )}
                    {/* Password last updated. Prefers the dedicated
                        passwordUpdatedAt stamp (set on real password
                        changes — manual edit or extension capture);
                        falls back to the entry's general updatedAt for
                        legacy rows that haven't been touched since the
                        column was added. */}
                    {(cred.passwordUpdatedAt || cred.updatedAt) && (
                      <p
                        className="text-[10px] mt-1 text-stone-500"
                        title={
                          cred.passwordUpdatedAt
                            ? `Password updated ${new Date(cred.passwordUpdatedAt).toLocaleString()}`
                            : `Entry updated ${new Date(cred.updatedAt!).toLocaleString()}`
                        }
                      >
                        🔑 {new Date(cred.passwordUpdatedAt ?? cred.updatedAt!).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {canEdit && editingId !== cred.id && (
                    <button
                      type="button"
                      onClick={() => startEdit(cred)}
                      title="Edit this credential"
                      className="shrink-0 p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </div>

                {/* Inline edit form — replaces user/pass/notes when active */}
                {editingId === cred.id ? (
                  <div className="space-y-2 mt-2">
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">Title</span>
                      <input
                        type="text"
                        value={editFields.title}
                        onChange={(e) => setEditFields({ ...editFields, title: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">URL</span>
                      <input
                        type="text"
                        value={editFields.url}
                        onChange={(e) => setEditFields({ ...editFields, url: e.target.value })}
                        placeholder="https://..."
                        className="mt-1 w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">Username</span>
                      <input
                        type="text"
                        value={editFields.username}
                        onChange={(e) => setEditFields({ ...editFields, username: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">Password</span>
                      <input
                        type="text"
                        value={editFields.password}
                        onChange={(e) => setEditFields({ ...editFields, password: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">Notes</span>
                      <textarea
                        rows={2}
                        value={editFields.noteContent}
                        onChange={(e) => setEditFields({ ...editFields, noteContent: e.target.value })}
                        className="mt-1 w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50 resize-none"
                      />
                    </label>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={isPending}
                        className="flex-1 py-1.5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:text-stone-500 text-white text-sm font-medium rounded-lg transition"
                      >
                        {isPending ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={isPending}
                        className="px-3 py-1.5 text-stone-400 hover:text-stone-200 text-sm transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                <>

                {/* Username */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 w-12 shrink-0">User</span>
                  <span className="text-sm text-stone-200 break-all flex-1 min-w-0">
                    {cred.username || <span className="text-stone-600">—</span>}
                  </span>
                  {cred.username && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(cred.username!, `${cred.id}:user`)}
                      title="Copy username"
                      className={clsx(
                        'shrink-0 p-1.5 rounded transition',
                        copiedField === `${cred.id}:user` ? 'text-emerald-400' : 'text-stone-500 hover:text-stone-200'
                      )}
                    >
                      {copiedField === `${cred.id}:user` ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>

                {/* Password */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-stone-500 w-12 shrink-0">Pass</span>
                  <span className={clsx('text-sm font-mono break-all flex-1 min-w-0', isRevealed ? 'text-emerald-300' : 'text-stone-400')}>
                    {cred.password
                      ? (isRevealed ? cred.password : '••••••••••')
                      : <span className="text-stone-600 font-sans">—</span>}
                  </span>
                  {cred.password && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleReveal(cred.id)}
                        title={isRevealed ? 'Hide' : 'Reveal'}
                        className="shrink-0 p-1.5 rounded text-stone-500 hover:text-stone-200 transition"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(cred.password!, `${cred.id}:pass`)}
                        title="Copy password"
                        className={clsx(
                          'shrink-0 p-1.5 rounded transition',
                          copiedField === `${cred.id}:pass` ? 'text-emerald-400' : 'text-stone-500 hover:text-stone-200'
                        )}
                      >
                        {copiedField === `${cred.id}:pass` ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </>
                  )}
                </div>

                {/* Notes */}
                {cred.noteContent && (
                  <div className="flex items-start gap-2 min-w-0 pt-1">
                    <span className="text-[10px] uppercase tracking-wider text-stone-500 w-12 shrink-0 mt-0.5">Notes</span>
                    <p className="text-xs text-stone-400 whitespace-pre-wrap break-words flex-1 min-w-0">
                      <LinkifiedText text={cred.noteContent} />
                    </p>
                  </div>
                )}

                {/* Bottom-left actions row — separated from the per-field copy/eye buttons above */}
                {canEdit && !isMaster && (
                  <div className="flex items-center gap-2 pt-2 mt-1 border-t border-stone-700/40">
                    <button
                      type="button"
                      onClick={() => handlePromote(cred.id)}
                      title="Make this the master credential"
                      disabled={isPending}
                      className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-emerald-300 hover:bg-emerald-950/30 transition px-2 py-1 border border-stone-700 hover:border-emerald-700/50 rounded"
                    >
                      <Star size={11} /> Master
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnlink(cred.id)}
                      title="Unlink (keep as separate entry)"
                      disabled={isPending}
                      className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition px-2 py-1 border border-stone-700 rounded"
                    >
                      <ArrowUpRight size={11} /> Unlink
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(cred.id)}
                      title={confirmRemoveId === cred.id ? 'Click again to confirm delete' : 'Delete this credential'}
                      disabled={isPending}
                      className={clsx(
                        'flex items-center gap-1 text-[11px] transition px-2 py-1 rounded border',
                        confirmRemoveId === cred.id
                          ? 'bg-red-700 border-red-600 text-white'
                          : 'text-stone-400 hover:text-red-400 hover:bg-red-950/30 border-stone-700 hover:border-red-700/50'
                      )}
                    >
                      <X size={11} /> {confirmRemoveId === cred.id ? 'Sure?' : 'Delete'}
                    </button>
                  </div>
                )}
                </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add form */}
      {canEdit && showAdd && (
        <div className="mt-3 p-3 bg-stone-900/40 border border-stone-700/40 rounded-xl space-y-2">
          <input
            type="text"
            placeholder="Username / email"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
          />
          <input
            type="text"
            placeholder="Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
          />
          <textarea
            rows={2}
            placeholder="Notes (optional)"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-600/50 resize-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending || (!newUsername && !newPassword)}
              className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-medium rounded-lg transition"
            >
              {isPending ? 'Adding...' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setNewUsername(''); setNewPassword(''); setNewNote('') }}
              className="px-4 py-1.5 text-stone-400 hover:text-stone-200 text-sm transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
