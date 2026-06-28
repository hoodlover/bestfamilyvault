'use client'

// Registers the service worker AND auto-recovers from stale SW state.
//
// Why the recovery: we hit a class of bug where an older sw.js had cached
// HTML pages or 5xx responses, and those stuck around even after we shipped
// fixes. The SW's own activate handler couldn't help because the new SW
// wasn't being downloaded (browser cached sw.js, or skipWaiting hadn't run
// before the user navigated). The page itself can sidestep all that.
//
// On every load, we compare the current APP_VERSION (built into the bundle)
// against a localStorage marker. If they differ, we:
//   1. unregister every SW for this origin
//   2. delete every cache
//   3. update the marker
//   4. hard-reload once
// First-time visitors (no marker) just set the marker silently — no reload.

import { useEffect } from 'react'
import { APP_VERSION } from '@/lib/branding'

const VERSION_KEY = 'bestfamilyvault-app-version'

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false

    async function run() {
      const stored = localStorage.getItem(VERSION_KEY)

      // Mismatch and not a first-time visitor → recover.
      if (stored && stored !== APP_VERSION) {
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations()
            await Promise.all(regs.map((r) => r.unregister()))
          }
          if ('caches' in window) {
            const keys = await caches.keys()
            await Promise.all(keys.map((k) => caches.delete(k)))
          }
        } catch {
          // Best-effort — even if cleanup fails, set the marker and reload
          // so we don't loop on this branch forever.
        }
        localStorage.setItem(VERSION_KEY, APP_VERSION)
        if (!cancelled) location.reload()
        return
      }

      // First visit OR same version — just record and proceed.
      if (!stored) localStorage.setItem(VERSION_KEY, APP_VERSION)

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .catch(() => {
            // SW not critical — fail silently
          })
      }
    }

    run()
    return () => { cancelled = true }
  }, [])

  return null
}
