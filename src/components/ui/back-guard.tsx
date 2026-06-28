'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { APP_SHORT_NAME } from '@/lib/branding'
import { closeTopModal } from '@/lib/modal-stack'

// Pathnames where pressing the device/browser back button would normally
// exit the app/PWA. We intercept that and ask for confirmation.
const ROOT_PATHS = ['/dashboard']

export function BackGuard() {
  const pathname = usePathname()
  const [showPrompt, setShowPrompt] = useState(false)
  const guarding = useRef(false)

  useEffect(() => {
    if (!ROOT_PATHS.includes(pathname)) return

    guarding.current = true
    // Push a sentinel history entry preserving Next.js's existing route state.
    // (Replacing state with a fresh object would break App Router's internal
    // tracking and cause Link clicks to misbehave.)
    const armSentinel = () => {
      window.history.pushState(window.history.state, '', window.location.href)
    }
    armSentinel()

    function onPop() {
      if (!guarding.current) return
      // Always re-arm the sentinel so we keep guarding subsequent
      // back presses even if a modal handles this one.
      armSentinel()
      // If a modal is open, the back press is "close that modal"
      // first, NOT "leave the vault." Only show the leave prompt
      // when no modal claimed the press.
      if (closeTopModal()) return
      setShowPrompt(true)
    }

    window.addEventListener('popstate', onPop)
    return () => {
      guarding.current = false
      window.removeEventListener('popstate', onPop)
    }
  }, [pathname])

  function handleStay() {
    setShowPrompt(false)
  }

  function handleLeave() {
    setShowPrompt(false)
    guarding.current = false
    // Pop our sentinel + the entry we just re-armed, plus the original.
    // Two back() steps gets the user out of the app.
    window.history.go(-2)
  }

  if (!showPrompt) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-stone-900 border border-amber-700/50 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-amber-950/60 border border-amber-700/50">
            <AlertTriangle size={20} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-100">Leave the vault?</h2>
            <p className="text-sm text-stone-400 mt-1">
              You&apos;re about to exit {APP_SHORT_NAME}. Stay if that wasn&apos;t on purpose.
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleLeave}
            className="px-3 py-2 text-sm text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg transition"
          >
            Leave
          </button>
          <button
            type="button"
            onClick={handleStay}
            autoFocus
            className="px-4 py-2 text-sm font-medium bg-amber-700 hover:bg-amber-600 text-white rounded-lg transition"
          >
            Stay
          </button>
        </div>
      </div>
    </div>
  )
}
