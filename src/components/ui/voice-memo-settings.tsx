'use client'

// Superuser-only Settings section: list every family member with a record /
// re-record / remove button. Each click opens the VoiceMemoRecorder modal.

import { useState } from 'react'
import { Mic, Check, UserRound } from 'lucide-react'
import { VoiceMemoRecorder } from './voice-memo-recorder'

interface FamilyMember {
  id: string
  name: string | null
  email: string | null
  hasImage: boolean
  updatedAt: number
  hasVoiceMemo: boolean
}

interface Props {
  members: FamilyMember[]
}

export function VoiceMemoSettings({ members }: Props) {
  const [target, setTarget] = useState<FamilyMember | null>(null)

  return (
    <>
      <p className="text-sm text-stone-400 mb-4 leading-relaxed">
        Record a short greeting (≤30 sec) for each family member. Anyone in the
        family can hear it by tapping that person&rsquo;s avatar five times in a
        row on the dashboard. The memo replaces the previous one each time you
        re-record.
      </p>

      <ul className="divide-y divide-stone-800 rounded-xl border border-stone-700/60 overflow-hidden">
        {members.map((m) => {
          const display = m.name?.split(' ')[0] ?? m.email ?? 'User'
          const src = m.hasImage ? `/api/avatars/${m.id}?v=${m.updatedAt}` : null
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 bg-stone-800/30">
              <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-stone-700 border border-stone-600 flex items-center justify-center">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound size={16} className="text-stone-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-200 truncate">{m.name ?? m.email}</p>
                <p className="text-[11px] text-stone-500">
                  {m.hasVoiceMemo
                    ? <span className="inline-flex items-center gap-1 text-emerald-400/80"><Check size={11} /> memo on file</span>
                    : <span>no memo yet</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTarget(m)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-700 hover:bg-stone-600 text-stone-100 rounded-lg transition"
              >
                <Mic size={12} />
                {m.hasVoiceMemo ? 'Re-record' : 'Record'}
              </button>
            </li>
          )
        })}
      </ul>

      {target && (
        <VoiceMemoRecorder
          targetUserId={target.id}
          targetName={target.name?.split(' ')[0] ?? target.email ?? 'User'}
          currentMemoUrl={target.hasVoiceMemo ? `/api/voice-memos/${target.id}?v=${target.updatedAt}` : null}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  )
}
