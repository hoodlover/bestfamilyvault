'use client'

// Mobile-only wrapper that auto-collapses its children (the dashboard
// greeting + search pill) 30 seconds after they appear. Once dismissed
// the hero stays gone until one of two things happens:
//
//   1. The user force-closes the app and reopens it. sessionStorage
//      clears on tab close, so the next page mount reads "no dismiss
//      record" → renders the hero again.
//   2. More than 24 hours pass since the last auto-dismiss. The
//      timestamp is checked against now-24h on every mount and treated
//      as expired beyond that window.
//
// Crucially, screen-off + reopen (the PWA wake case) does NOT reload
// the page, so React state stays put — once collapsed, it stays
// collapsed for the life of the app session.
//
// useLayoutEffect runs synchronously before the browser paints so a
// returning visitor (within the 24h window, same session) sees no
// flash of the hero before it collapses; the initial paint is already
// the collapsed state. First-time visitors see the hero, the
// transition-enable flag flips after a beat, and the 30s timer drives
// the slide-up.

import { clsx } from 'clsx'
import { useState, useLayoutEffect, useRef } from 'react'

const STORAGE_KEY = 'bestfamilyvault:mobile-hero-dismissed-at'
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000   // 24 hours
const SHOW_DURATION_MS = 30 * 1000             // 30 seconds before auto-collapse

interface Props {
  children: React.ReactNode
}

export function MobileHeroDismiss({ children }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [transitionEnabled, setTransitionEnabled] = useState(false)
  const ranRef = useRef(false)

  useLayoutEffect(() => {
    // Strict-mode guard — useLayoutEffect can fire twice in dev. The
    // setTimeout cleanup handles it but the storage check is idempotent
    // anyway.
    if (ranRef.current) return
    ranRef.current = true

    let dismissedAt: number | null = null
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) dismissedAt = parsed
      }
    } catch {
      // private mode or storage disabled — fall through, show hero
    }

    const isFresh = dismissedAt != null && Date.now() - dismissedAt < FRESH_WINDOW_MS
    if (isFresh) {
      // Returning visitor inside the 24h window → start collapsed, no
      // transition so the user sees nothing flash in or out. The setState
      // call is exactly what useLayoutEffect is for here (syncing with
      // sessionStorage, which IS an external system the rule mentions).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI with the external sessionStorage store
      setCollapsed(true)
      return
    }

    // Show the hero. Enable transitions after a beat so the FIRST paint
    // is the visible state (no slide-in animation), and the SECOND state
    // change after 30 s is the slide-up animation.
    const enableId = window.setTimeout(() => setTransitionEnabled(true), 60)
    const collapseId = window.setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, String(Date.now()))
      } catch {}
      setCollapsed(true)
    }, SHOW_DURATION_MS)
    return () => {
      window.clearTimeout(enableId)
      window.clearTimeout(collapseId)
    }
  }, [])

  return (
    <div
      className={clsx(
        'overflow-hidden',
        transitionEnabled && 'transition-all duration-500 ease-out',
        // Mobile collapse — desktop overrides keep the wrapper at natural
        // height regardless of state, so this can wrap content that shows
        // on every breakpoint without making desktop disappear too.
        // max-h-[260px] covers the compact CobbBanner (max-h-32 image +
        // mb-5 wrapper). Bump if you wrap something taller.
        collapsed
          ? 'max-h-0 opacity-0 -translate-y-3 md:max-h-none md:opacity-100 md:translate-y-0'
          : 'max-h-[260px] opacity-100 translate-y-0',
      )}
      aria-hidden={collapsed}
    >
      {children}
    </div>
  )
}
