'use client'

// Three idempotent "set up X" buttons for the admin page. Each calls a
// server action that creates structure if missing or returns the existing
// reference if already there. Click freely — no harm in clicking twice.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Check } from 'lucide-react'
import {
  generateRecoveryGuide,
  seedLegalCategory,
  ensureSubscriptionsSubcategory,
} from '@/lib/actions/family-setup'

export function FamilySetupButtons() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <SetupTile
        icon={<img src="/icons/cobb/icons/system/new_vault_guide_book.png" width={32} height={32} alt="" className="object-contain h-8 w-8" />}
        title="Vault Recovery Guide"
        detail="Creates a templated note in the Private Vault for a trusted person to read if you're suddenly out of the picture. Idempotent — opens the existing one if it's there."
        accent="pink"
        running={busyKey === 'recovery'}
        doneLabel={done['recovery'] ?? null}
        onClick={() => {
          setError(null)
          setBusyKey('recovery')
          startTransition(async () => {
            const res = await generateRecoveryGuide()
            setBusyKey(null)
            if ('error' in res) { setError(res.error); return }
            setDone((p) => ({ ...p, recovery: res.existed ? 'Opened existing' : 'Created' }))
            router.push(`/notes/${res.noteId}`)
          })
        }}
      />

      <SetupTile
        icon={<img src="/icons/cobb/icons/legal/legal.png" width={32} height={32} alt="" className="object-contain h-8 w-8" />}
        title="Legal Documents Category"
        detail="Creates a top-level Legal category with subcategories: Wills, Healthcare Directives, Powers of Attorney, Beneficiary Forms, Trusts, Estate Planning. Upload the scans into the right slots."
        accent="amber"
        running={busyKey === 'legal'}
        doneLabel={done['legal'] ?? null}
        onClick={() => {
          setError(null)
          setBusyKey('legal')
          startTransition(async () => {
            const res = await seedLegalCategory()
            setBusyKey(null)
            if ('error' in res) { setError(res.error); return }
            const label = res.created === 0 ? 'Already set up' : `Created ${res.created}, kept ${res.existed}`
            setDone((p) => ({ ...p, legal: label }))
            router.push(`/categories/${res.categorySlug}`)
          })
        }}
      />

      <SetupTile
        icon={<img src="/icons/cobb/icons/system/subscription_tracker.png" width={32} height={32} alt="" className="object-contain h-8 w-8" />}
        title="Subscriptions Tracker"
        detail="Creates a Subscriptions subcategory under Finance and a /subscriptions view. Move recurring-charge logins there and add renewal dates so you know what'll fail when a card gets compromised."
        accent="emerald"
        running={busyKey === 'subs'}
        doneLabel={done['subs'] ?? null}
        onClick={() => {
          setError(null)
          setBusyKey('subs')
          startTransition(async () => {
            const res = await ensureSubscriptionsSubcategory()
            setBusyKey(null)
            if ('error' in res) { setError(res.error); return }
            setDone((p) => ({ ...p, subs: 'Set up — see /subscriptions' }))
            router.push('/subscriptions')
          })
        }}
      />

      {error && (
        <p className="sm:col-span-2 text-sm text-red-400">{error}</p>
      )}
    </div>
  )
}

interface TileProps {
  icon: React.ReactNode
  title: string
  detail: string
  accent: 'pink' | 'amber' | 'emerald'
  running: boolean
  doneLabel: string | null
  onClick: () => void
}

function SetupTile({ icon, title, detail, accent, running, doneLabel, onClick }: TileProps) {
  const ring = accent === 'pink'
    ? 'hover:border-pink-700/50'
    : accent === 'amber'
    ? 'hover:border-amber-700/50'
    : 'hover:border-emerald-700/50'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      className={`group flex items-start gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 ${ring} rounded-xl transition disabled:opacity-60 text-left`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900/60 border border-stone-700/40 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-100">{title}</p>
        <p className="text-xs text-stone-400 mt-1 leading-snug">{detail}</p>
        {doneLabel && (
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <Check size={11} /> {doneLabel}
          </p>
        )}
      </div>
      {running ? (
        <span className="w-3 h-3 mt-1 border border-stone-500 border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0 mt-1" />
      )}
    </button>
  )
}
