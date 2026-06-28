'use client'

// Modal that pops up when a delete is blocked because the category /
// subcategory still has children. Asks the user how to handle it:
//
//   1. Bulk-move everything to another category (or subcategory) and
//      then delete the source.
//   2. Open the per-item Reclassify tool to check-mark which to move.
//   3. Cancel and handle one-by-one in the regular UI.
//
// Same component handles both kinds (category / subcategory). The
// caller wires up the right server action and target list.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, X, FolderInput, ListChecks } from 'lucide-react'

interface BlockerCounts {
  entries?: number
  notes?: number
  files?: number
  subcategories?: number
}

interface Props {
  kind: 'category' | 'subcategory'
  sourceName: string
  sourceId: string
  /** Counts that came back from the blocked delete. */
  blockers: BlockerCounts
  /** Eligible move-to targets. */
  targets: { id: string; name: string }[]
  /** Set true when the kind is subcategory — adds an "Uncategorized (no
   *  subcategory)" target as id=null. */
  allowNoTarget?: boolean
  /** Calls the server action that moves everything and deletes the source. */
  onMoveAll: (targetId: string | null) => Promise<{ error?: string } | object>
  /** Optional href the "Pick what to move" button navigates to. */
  reclassifyHref?: string
  onClose: () => void
}

export function DeleteBlockedModal({
  kind, sourceName, blockers, targets, allowNoTarget,
  onMoveAll, reclassifyHref, onClose,
}: Props) {
  const router = useRouter()
  const [targetId, setTargetId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blockerLines: string[] = []
  if (blockers.entries) blockerLines.push(`${blockers.entries} entr${blockers.entries === 1 ? 'y' : 'ies'}`)
  if (blockers.notes) blockerLines.push(`${blockers.notes} note${blockers.notes === 1 ? '' : 's'}`)
  if (blockers.files) blockerLines.push(`${blockers.files} file${blockers.files === 1 ? '' : 's'}`)
  if (blockers.subcategories) blockerLines.push(`${blockers.subcategories} subcategor${blockers.subcategories === 1 ? 'y' : 'ies'}`)

  async function moveAll() {
    setError(null)
    if (!targetId) {
      setError('Pick a destination first.')
      return
    }
    setBusy(true)
    const id = targetId === '__none__' ? null : targetId
    const res = await onMoveAll(id)
    setBusy(false)
    if (res && 'error' in res && typeof (res as { error?: string }).error === 'string') {
      setError((res as { error: string }).error)
      return
    }
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { if (!busy) onClose() }}>
      <div className="w-full max-w-md rounded-2xl border border-amber-700/50 bg-stone-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-amber-950/60 border border-amber-700/50">
            <AlertTriangle size={18} className="text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-stone-100">
              Can&rsquo;t delete &ldquo;{sourceName}&rdquo; yet
            </h2>
            <p className="text-sm text-stone-400 mt-1">
              It still contains {blockerLines.join(', ')}. Pick how you want to handle them.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-50" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Option 1: Bulk move */}
        <div className="px-5 pt-5 pb-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
            <FolderInput size={13} className="text-sky-400" />
            Move everything to one place
          </p>
          <p className="text-xs text-stone-500 mt-1">
            Fastest — one click moves every {kind === 'category' ? 'entry, note, file, and subcategory' : 'entry and note'} to the destination, then deletes &ldquo;{sourceName}&rdquo;.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
              className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            >
              <option value="">— Pick destination —</option>
              {allowNoTarget && <option value="__none__">No subcategory (un-categorize)</option>}
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={moveAll}
              disabled={busy || !targetId}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium bg-sky-700 hover:bg-sky-600 disabled:bg-sky-900 disabled:opacity-60 text-white rounded-lg transition"
            >
              {busy ? (
                <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Moving…</>
              ) : 'Move & delete'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        <div className="border-t border-stone-800/80 mx-5"></div>

        {/* Option 2: Per-item reclassify */}
        {reclassifyHref && (
          <div className="px-5 py-3">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
              <ListChecks size={13} className="text-emerald-400" />
              Pick which to move
            </p>
            <p className="text-xs text-stone-500 mt-1">
              Open the Mass Reclassify tool — check the boxes you want to move, send them wherever. Comes back here to delete when empty.
            </p>
            <Link
              href={reclassifyHref}
              onClick={onClose}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg transition"
            >
              <ListChecks size={14} />
              Open reclassify
            </Link>
          </div>
        )}

        <div className="border-t border-stone-800/80 mx-5"></div>

        {/* Option 3: Cancel */}
        <div className="px-5 py-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-2 text-sm font-medium text-stone-400 hover:text-stone-200 transition disabled:opacity-50"
          >
            I&rsquo;ll handle it one by one
          </button>
        </div>
      </div>
    </div>
  )
}
