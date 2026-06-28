'use client'

import { useEffect, useState } from 'react'
import { X, Download } from 'lucide-react'

const DISMISSED_KEY = 'pwa_install_dismissed_v1'
const DISMISS_HIDE_DAYS = 14

// Chrome's beforeinstallprompt event — only shipped on Chromium-based browsers.
// Other platforms (iOS Safari) don't expose a programmatic prompt; we fall
// back to manual instructions.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // PWA in standalone mode (Android Chrome, iOS Safari, desktop install).
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Older iOS Safari uses a non-standard `navigator.standalone`.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return false
    const dismissedAt = Number(raw)
    if (!Number.isFinite(dismissedAt)) return false
    const ageMs = Date.now() - dismissedAt
    return ageMs < DISMISS_HIDE_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export function PWAInstallPrompt() {
  const [show, setShow] = useState(false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHelp, setShowIOSHelp] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (dismissedRecently()) return

    // Chromium path — wait for the browser to tell us we're installable.
    function onPrompt(e: Event) {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS path — Safari never fires beforeinstallprompt. Show the manual
    // "Add to Home Screen" hint after a short delay so it doesn't blast the
    // user the moment they sign in.
    let iosTimer: ReturnType<typeof setTimeout> | null = null
    if (isIOS()) {
      iosTimer = setTimeout(() => {
        if (!isStandalone() && !dismissedRecently()) setShow(true)
      }, 4000)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* ignore */ }
    setShow(false)
    setShowIOSHelp(false)
  }

  async function install() {
    if (installEvent) {
      try {
        await installEvent.prompt()
        const { outcome } = await installEvent.userChoice
        if (outcome === 'accepted') {
          dismiss()
        }
      } catch {
        // user-cancelled or browser denied
      }
      return
    }
    if (isIOS()) {
      setShowIOSHelp(true)
    }
  }

  if (!show) return null

  return (
    <div className="fixed bottom-20 md:bottom-4 left-3 right-3 md:left-auto md:right-4 md:max-w-sm z-30">
      <div className="rounded-2xl border border-emerald-700/40 bg-stone-900/95 backdrop-blur-md shadow-2xl p-4">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/cfv-pwa.png"
            alt=""
            width={40}
            height={40}
            className="block h-10 w-10 object-contain shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-100">Install Family Vault</p>
            <p className="text-xs text-stone-400 mt-0.5 leading-snug">
              Add it to your home screen for quick, offline access — feels like a real app, no browser bar.
            </p>
            {showIOSHelp && (
              <p className="text-xs text-emerald-300 mt-2 leading-snug">
                In Safari, tap the <span className="font-semibold">Share</span> icon, scroll down, then tap
                <span className="font-semibold"> Add to Home Screen</span>.
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={install}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-md transition"
              >
                <Download size={13} />
                Install
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="px-3 py-1.5 text-xs font-medium text-stone-400 hover:text-stone-200 transition"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
