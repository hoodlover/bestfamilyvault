'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, ArrowRight } from 'lucide-react'

interface Match {
  id: string
  title: string
  type: string
  category: string | null
}

/**
 * Small banner that watches the new-entry form's Title input and
 * surfaces existing entries with similar titles BEFORE the user
 * creates a duplicate. Click a chip → land on that entry to edit
 * instead.
 *
 * The Title input is uncontrolled (defaultValue), so we hook a
 * `keyup` listener on the form-level container and read whatever's
 * in the input named 'title'. Debounced.
 */
export function ExistingEntryAlert() {
  const [matches, setMatches] = useState<Match[]>([])
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastQuery = useRef<string>('')

  useEffect(() => {
    function onKeyup(e: KeyboardEvent) {
      const target = e.target as HTMLInputElement | null
      if (!target || target.name !== 'title') return
      const q = (target.value ?? '').trim()
      if (q.length < 3) {
        setMatches([])
        return
      }
      if (q === lastQuery.current) return
      lastQuery.current = q
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/entries/search?q=${encodeURIComponent(q)}`)
          const data = await res.json()
          if (Array.isArray(data.matches)) setMatches(data.matches)
        } catch {
          // best-effort; silent failure is fine for an advisory banner
        }
      }, 350)
    }
    document.addEventListener('keyup', onKeyup, true)
    return () => {
      document.removeEventListener('keyup', onKeyup, true)
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  // Reset dismissal when matches change so a new typed value re-shows.
  useEffect(() => {
    setDismissedFor(null)
  }, [matches.length])

  if (matches.length === 0) return null
  const matchesKey = matches.map((m) => m.id).join('|')
  if (dismissedFor === matchesKey) return null

  return (
    <div className="mb-3 rounded-xl border border-amber-700/30 bg-amber-950/20 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Search size={14} className="text-amber-300/80 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-200/90 mb-1.5">
            <strong>Already in the vault?</strong> Found {matches.length} similar entr{matches.length === 1 ? 'y' : 'ies'} — click to edit one instead of making a duplicate.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((m) => (
              <Link
                key={m.id}
                href={`/entries/${m.id}/edit`}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-900/30 hover:bg-amber-800/50 border border-amber-700/30 text-amber-100 rounded-full transition"
              >
                {m.title}
                {m.category && <span className="text-amber-400/70">· {m.category}</span>}
                <ArrowRight size={10} />
              </Link>
            ))}
            <button
              type="button"
              onClick={() => setDismissedFor(matchesKey)}
              className="text-[11px] text-stone-500 hover:text-stone-300 ml-2"
            >
              Keep adding new ×
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
