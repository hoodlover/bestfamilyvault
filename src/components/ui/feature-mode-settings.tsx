'use client'

import { useEffect, useState } from 'react'
import { FEATURE_MODES, getFeatureMode } from '@/lib/feature-modes'

const STORAGE_KEY = 'bestfamilyvault.featureMode'

export function FeatureModeSettings() {
  const [modeId, setModeId] = useState('simple')
  const mode = getFeatureMode(modeId)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) setModeId(stored)
  }, [])

  function choose(next: string) {
    setModeId(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    document.documentElement.dataset.featureMode = next
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURE_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => choose(item.id)}
            className={`rounded-xl border p-3 text-left transition ${
              modeId === item.id
                ? 'border-emerald-500/70 bg-emerald-950/30 text-emerald-50'
                : 'border-stone-700 bg-stone-900/50 text-stone-300 hover:bg-stone-800'
            }`}
          >
            <span className="block text-sm font-semibold">{item.label}</span>
            <span className="mt-1 block text-xs leading-5 text-stone-400">{item.description}</span>
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-stone-800 bg-stone-950/50 p-3 text-xs leading-5 text-stone-400">
        Active mode: <span className="font-semibold text-stone-200">{mode.label}</span>. This setting is local
        to this device for now; the next step is account-level storage and automatic menu hiding.
      </div>
    </div>
  )
}
