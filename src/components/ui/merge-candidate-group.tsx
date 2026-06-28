'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { GitMerge, X, Star, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { mergeEntries } from '@/lib/actions/entries'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries>

interface Props {
  fingerprint: string
  entries: Entry[]
  catMap: Record<string, string>
}

// Pick the best default master: prefer entries with a non-empty username and
// the most-recently-updated timestamp.
function pickDefaultMaster(arr: Entry[]): string {
  const sorted = [...arr].sort((a, b) => {
    const aHasUser = a.username ? 1 : 0
    const bHasUser = b.username ? 1 : 0
    if (aHasUser !== bHasUser) return bHasUser - aHasUser
    return new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()
  })
  return sorted[0].id
}

export function MergeCandidateGroup({ fingerprint, entries: groupEntries, catMap }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [masterId, setMasterId] = useState<string>(() => pickDefaultMaster(groupEntries))
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState(false)

  const includedEntries = useMemo(
    () => groupEntries.filter((e) => !excluded.has(e.id)),
    [groupEntries, excluded]
  )

  function toggleExclude(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // If we just excluded the master, pick a new master from what's left
      if (next.has(masterId)) {
        const fallback = groupEntries.find((e) => !next.has(e.id))
        if (fallback) setMasterId(fallback.id)
      }
      return next
    })
  }

  function handleMerge() {
    if (includedEntries.length < 2 || excluded.has(masterId)) return
    const ids = includedEntries.map((e) => e.id)
    startTransition(async () => {
      const result = await mergeEntries(ids, masterId)
      if (!result?.error) {
        // Hide the group locally as soon as the merge succeeds. Without this
        // the group sticks around until the RSC re-fetch lands, which can
        // take a beat in production and confuses "where do I go next?"
        setSkipped(true)
        router.refresh()
      }
    })
  }

  if (skipped) return null

  const master = groupEntries.find((e) => e.id === masterId)
  const displayName = fingerprint.startsWith('t:') ? fingerprint.slice(2) : fingerprint
  const isUrlFingerprint = !fingerprint.startsWith('t:')

  return (
    <div className="rounded-2xl border border-stone-700/50 bg-stone-800/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-stone-800/60 border-b border-stone-700/50 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {isUrlFingerprint && (
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-stone-700/60 border border-stone-600/50 shrink-0">
              <span className="text-xs font-mono text-stone-400">{displayName.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-stone-100 truncate">{displayName}</h3>
              {isUrlFingerprint && (
                <a
                  href={`https://${displayName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-500 hover:text-stone-300 transition shrink-0"
                  title="Open site"
                >
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            <p className="text-xs text-stone-500 mt-0.5">
              {groupEntries.length} entries · {includedEntries.length} will merge
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSkipped(true)}
            disabled={isPending}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 transition"
          >
            Skip group
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={isPending || includedEntries.length < 2 || excluded.has(masterId)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-white transition"
          >
            <GitMerge size={13} />
            {isPending ? 'Merging...' : `Merge ${includedEntries.length}`}
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-stone-700/40">
        {groupEntries.map((entry) => {
          const isExcluded = excluded.has(entry.id)
          const isMaster = entry.id === masterId
          return (
            <div
              key={entry.id}
              className={clsx(
                'flex items-center gap-3 px-4 py-2.5 transition',
                isExcluded && 'opacity-40',
                isMaster && !isExcluded && 'bg-amber-950/20'
              )}
            >
              {/* Master radio */}
              <button
                type="button"
                onClick={() => !isExcluded && setMasterId(entry.id)}
                disabled={isExcluded}
                title={isMaster ? 'This is the master' : 'Make this the master'}
                className={clsx(
                  'shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 transition',
                  isMaster
                    ? 'border-amber-400 bg-amber-500/30'
                    : 'border-stone-600 hover:border-amber-400 disabled:hover:border-stone-600'
                )}
              >
                {isMaster && <span className="w-2 h-2 rounded-full bg-amber-300" />}
              </button>

              {/* Include checkbox */}
              <button
                type="button"
                onClick={() => toggleExclude(entry.id)}
                title={isExcluded ? 'Include' : 'Exclude from merge'}
                className={clsx(
                  'shrink-0 flex items-center justify-center w-5 h-5 rounded border transition',
                  !isExcluded ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-600 hover:border-stone-400'
                )}
              >
                {!isExcluded && <span className="w-2.5 h-2.5 bg-white rounded-sm" />}
              </button>

              {/* Content */}
              <Link
                href={`/entries/${entry.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-x-3 gap-y-0.5 items-center"
              >
                <div className="min-w-0 flex items-center gap-1.5">
                  {isMaster && !isExcluded && (
                    <Star size={10} className="text-amber-400 fill-amber-400 shrink-0" />
                  )}
                  <span className="text-sm text-stone-200 truncate">{entry.title}</span>
                </div>
                <span className="text-xs text-stone-400 truncate">
                  {entry.username || <span className="text-stone-600">no username</span>}
                </span>
                <span className="text-[10px] text-stone-500 shrink-0 truncate max-w-[100px]">
                  {catMap[entry.categoryId] ?? entry.type}
                </span>
              </Link>

              {/* Quick exclude X */}
              {!isExcluded && (
                <button
                  type="button"
                  onClick={() => toggleExclude(entry.id)}
                  title="Exclude from this merge"
                  className="shrink-0 p-1 text-stone-600 hover:text-stone-300 transition"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {master && (
        <div className="px-4 py-2 bg-stone-900/40 border-t border-stone-700/40 text-[11px] text-stone-500">
          After merge: <span className="text-amber-300">{master.title}</span> stays as the visible
          card; {includedEntries.length - 1} other{includedEntries.length - 1 !== 1 ? 's' : ''}{' '}
          become Linked Credentials inside it.
        </div>
      )}
    </div>
  )
}
