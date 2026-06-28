'use client'

// Floating dock for iOS / Android PWAs (standalone mode). The native browser
// chrome (back button, refresh, URL bar) is hidden when the app is launched
// from the home screen, so users get stuck. This adds a small dock with:
//   ← Back
//   Refresh (force cache-bust)
//   v{N}  — current app version, helpful when debugging "did it deploy yet"
//
// Hidden in regular browser tabs so it doesn't clutter the desktop view.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, RefreshCw, AlertTriangle } from 'lucide-react'
import { APP_SHORT_NAME } from '@/lib/branding'

interface NavWithStandalone extends Navigator {
  standalone?: boolean
}

export function PWAToolbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [standalone, setStandalone] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exitConfirm, setExitConfirm] = useState(false)

  useEffect(() => {
    function check() {
      const mqStandalone = window.matchMedia('(display-mode: standalone)').matches
      // iOS Safari sets navigator.standalone instead of supporting display-mode.
      const iosStandalone = (window.navigator as NavWithStandalone).standalone === true
      setStandalone(mqStandalone || iosStandalone)
    }
    check()
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener('change', check)
    return () => mq.removeEventListener('change', check)
  }, [])

  if (!standalone) return null

  // On the dashboard there's nowhere to "go back" to — the only effect of
  // tapping the toolbar back button there is exiting the PWA. Confirm
  // first; on every other page the back button is a normal browser back.
  function handleBack() {
    if (pathname === '/dashboard') {
      setExitConfirm(true)
      return
    }
    router.back()
  }

  async function refresh() {
    setRefreshing(true)
    try {
      // Full cache bust: unregister all SWs, drop every Cache Storage bucket,
      // then reload. Belt-and-suspenders so a stale build can't get stuck on
      // someone's home-screen install.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const names = await caches.keys()
        await Promise.all(names.map((n) => caches.delete(n)))
      }
    } catch {
      // Even if cleanup partially fails, still try to reload — at worst
      // they get the SW-cached version, at best they get fresh.
    }
    // location.reload({ forceReload: true }) is non-standard; cache-buster
    // query param is more reliable across browsers.
    const url = new URL(window.location.href)
    url.searchParams.set('_v', String(Date.now()))
    window.location.replace(url.toString())
  }

  // 35% opacity overall (Lance asked for "65% transparent"). Hovering ramps
  // it to full opacity so a deliberate tap is unmistakable.
  return (
    <>
      <div
        className="fixed right-3 z-40 flex items-center gap-1 rounded-full border border-stone-700 bg-stone-900 px-2 py-1 shadow-lg backdrop-blur opacity-35 hover:opacity-100 focus-within:opacity-100 transition-opacity"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      >
        <button
          type="button"
          onClick={handleBack}
          title="Back"
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-full text-stone-300 hover:bg-stone-800 hover:text-stone-100 transition active:scale-95"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          title="Refresh app (clears cache)"
          aria-label="Refresh"
          className="flex h-8 w-8 items-center justify-center rounded-full text-stone-300 hover:bg-stone-800 hover:text-emerald-300 transition active:scale-95 disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {exitConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setExitConfirm(false)}
        >
          <div
            className="w-full max-w-sm bg-stone-900 border border-amber-700/50 rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-amber-950/60 border border-amber-700/50">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-stone-100">Leave the vault?</h2>
                <p className="text-sm text-stone-400 mt-1">
                  You&rsquo;re about to exit {APP_SHORT_NAME}. Stay if that wasn&rsquo;t on purpose.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setExitConfirm(false)
                  // Two-step: pop the sentinel BackGuard pushed (still on
                  // /dashboard) AND the original entry. window.history.go(-2)
                  // is what BackGuard does for the same reason.
                  window.history.go(-2)
                }}
                className="px-3 py-2 text-sm text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition"
              >
                Leave
              </button>
              <button
                type="button"
                onClick={() => setExitConfirm(false)}
                autoFocus
                className="px-4 py-2 text-sm font-medium bg-amber-700 hover:bg-amber-600 text-white rounded-lg transition"
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
