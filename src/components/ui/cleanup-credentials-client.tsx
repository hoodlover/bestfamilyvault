'use client'

// Triage client for /admin/cleanup-credentials. Each group renders its
// master + every child as a row. Children with identical
// username+password (within their group) are pre-ticked for deletion —
// keeping the oldest one as the survivor. Tick anything else by hand,
// then "Delete selected" runs a single bulk delete server call.
//
// Per-group "Delete entire group" button is the express lane for dead
// accounts: nukes the master + every child without ticking individually.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { bulkDeleteCredentials, deleteCredentialGroup } from '@/lib/actions/entries'

interface Credential {
  id: string
  title: string
  username: string | null
  password: string | null
  url: string | null
}

interface GroupRow {
  parentId: string
  parentTitle: string
  parentUsername: string | null
  parentPassword: string | null
  parentUrl: string | null
  categoryName: string
  children: Credential[]
}

interface Props {
  groups: GroupRow[]
}

export function CleanupCredentialsClient({ groups }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Pre-tick exact duplicates (within each group). Survivor = oldest
  // (children arrive already sorted oldest-first from the server).
  const initialSelection = useMemo(() => {
    const sel = new Set<string>()
    for (const g of groups) {
      const seen = new Set<string>()
      for (const c of g.children) {
        const key = `${c.username ?? ''}|${c.password ?? ''}`
        if (!c.username && !c.password) continue
        if (seen.has(key)) sel.add(c.id)
        else seen.add(key)
      }
    }
    return sel
  }, [groups])

  const [selected, setSelected] = useState<Set<string>>(initialSelection)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllIn(group: GroupRow) {
    const ids = group.children.map((c) => c.id)
    const allSelected = ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) for (const id of ids) next.delete(id)
      else for (const id of ids) next.add(id)
      return next
    })
  }

  function revealToggle(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setError(null)
    startTransition(async () => {
      const r = await bulkDeleteCredentials(ids)
      if (r?.error) {
        setError(r.error)
        return
      }
      setSelected(new Set())
      router.refresh()
    })
  }

  async function nukeGroup(parentId: string) {
    setError(null)
    setBusyGroupId(parentId)
    startTransition(async () => {
      const r = await deleteCredentialGroup(parentId)
      setBusyGroupId(null)
      if (r?.error) {
        setError(r.error)
        return
      }
      setConfirmGroupId(null)
      router.refresh()
    })
  }

  const selectedCount = selected.size

  return (
    <div className="space-y-4">
      {/* Sticky bulk-action bar — sits at the top so the count + button
          stays in reach as the user scrolls through groups. */}
      <div className="sticky top-0 z-20 -mx-4 md:mx-0 px-4 md:px-4 py-3 bg-stone-950/95 backdrop-blur border-b border-stone-800 flex items-center justify-between gap-3">
        <div className="text-sm">
          {selectedCount > 0 ? (
            <span className="text-amber-300 font-medium">
              {selectedCount} selected for delete
            </span>
          ) : (
            <span className="text-stone-500">Tick rows to delete</span>
          )}
        </div>
        <button
          type="button"
          onClick={bulkDelete}
          disabled={selectedCount === 0 || isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-red-900/40 hover:bg-red-900/60 disabled:bg-stone-800 disabled:text-stone-600 text-red-200 border border-red-800/60 rounded-lg transition"
        >
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete selected
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {groups.map((g) => {
        const groupSelectedCount = g.children.filter((c) => selected.has(c.id)).length
        const isConfirming = confirmGroupId === g.parentId
        const isThisBusy = busyGroupId === g.parentId
        return (
          <section
            key={g.parentId}
            className="rounded-xl border border-stone-800 bg-stone-900/40 overflow-hidden"
          >
            {/* Group header */}
            <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-800 bg-stone-950/40">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    ★ Master
                  </span>
                  <p className="text-sm font-semibold text-stone-100 truncate">
                    {g.parentTitle}
                  </p>
                </div>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  {g.children.length} linked credentials · {g.categoryName}
                  {g.parentUrl ? ` · ${displayUrl(g.parentUrl)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleAllIn(g)}
                  className="text-[11px] text-stone-400 hover:text-stone-200 transition"
                >
                  {g.children.every((c) => selected.has(c.id)) ? 'Untick all' : 'Tick all'}
                </button>
                {isConfirming ? (
                  <>
                    <button
                      type="button"
                      onClick={() => nukeGroup(g.parentId)}
                      disabled={isThisBusy}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-red-900/60 hover:bg-red-900/80 text-red-100 border border-red-700 rounded transition disabled:opacity-60"
                    >
                      {isThisBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmGroupId(null)}
                      className="text-[11px] text-stone-400 hover:text-stone-200 transition"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmGroupId(g.parentId)}
                    title="Delete master + every child"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-red-300 hover:text-red-100 hover:bg-red-950/40 rounded transition"
                  >
                    <Trash2 size={11} />
                    Delete group
                  </button>
                )}
              </div>
            </header>

            {/* Master row — read-only, no checkbox (group-delete handles it) */}
            <CredentialRow
              cred={{
                id: g.parentId,
                title: g.parentTitle,
                username: g.parentUsername,
                password: g.parentPassword,
                url: g.parentUrl,
              }}
              isMaster
              ticked={false}
              revealed={revealed.has(g.parentId)}
              onToggle={() => {}}
              onReveal={() => revealToggle(g.parentId)}
              isDupe={false}
            />

            {/* Children rows */}
            {g.children.map((c) => {
              const isAutoDupe = initialSelection.has(c.id)
              return (
                <CredentialRow
                  key={c.id}
                  cred={c}
                  isMaster={false}
                  ticked={selected.has(c.id)}
                  revealed={revealed.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onReveal={() => revealToggle(c.id)}
                  isDupe={isAutoDupe}
                />
              )
            })}

            {/* Footer count for this group */}
            <div className="px-4 py-2 bg-stone-950/30 border-t border-stone-800 text-[11px] text-stone-500 flex justify-between">
              <span>{groupSelectedCount} of {g.children.length} ticked</span>
              <span>oldest = master + first child kept by default</span>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CredentialRow({
  cred,
  isMaster,
  ticked,
  revealed,
  onToggle,
  onReveal,
  isDupe,
}: {
  cred: Credential
  isMaster: boolean
  ticked: boolean
  revealed: boolean
  onToggle: () => void
  onReveal: () => void
  isDupe: boolean
}) {
  const hasPass = !!cred.password
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-4 py-2.5 border-b border-stone-800/60 last:border-b-0',
        isMaster && 'bg-emerald-950/15',
        ticked && !isMaster && 'bg-red-950/20',
        isDupe && !ticked && 'bg-amber-950/20',
      )}
    >
      {!isMaster ? (
        <input
          type="checkbox"
          checked={ticked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 rounded border-stone-600 bg-stone-800 text-red-600 focus:ring-red-600"
          aria-label="Mark for delete"
        />
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {isMaster && (
            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              keep
            </span>
          )}
          {isDupe && !isMaster && (
            <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              auto-dupe
            </span>
          )}
          <p className="text-xs font-medium text-stone-200 truncate">{cred.title}</p>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-[11px]">
          <span className="text-stone-300 truncate font-mono">
            {cred.username || <span className="italic text-stone-600">(no user)</span>}
          </span>
          {hasPass ? (
            <span className="text-stone-400 font-mono truncate">
              {revealed ? cred.password : maskPassword(cred.password!)}
            </span>
          ) : (
            <span className="italic text-stone-600">(no pass)</span>
          )}
          {hasPass && (
            <button
              type="button"
              onClick={onReveal}
              className="text-stone-500 hover:text-stone-300 transition shrink-0"
              title={revealed ? 'Hide' : 'Reveal'}
            >
              {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function maskPassword(pw: string): string {
  if (pw.length <= 6) return '•'.repeat(pw.length)
  return pw.slice(0, 2) + '•'.repeat(Math.min(pw.length - 4, 10)) + pw.slice(-2)
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').slice(0, 40)
}
