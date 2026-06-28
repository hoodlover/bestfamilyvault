'use client'

// User-menu entry that triggers the PWA install flow. Hidden once the app
// is already installed (display-mode: standalone). On Chromium it tries
// the deferred beforeinstallprompt; on iOS it opens manual instructions.
// This is the always-available companion to the auto-shown PWAInstallPrompt
// — Lance noticed people weren't getting reminded to install, so the menu
// gives them a deliberate path.

import { useEffect, useState } from 'react'
import { Download, X, Share, Plus as PlusIcon } from 'lucide-react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

interface Props {
  /** Called when the user picks the menu item — typically closes the menu. */
  onAfterTrigger: () => void
}

export function InstallAppMenuItem({ onAfterTrigger }: Props) {
  const [hidden, setHidden] = useState(true)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [helpPlatform, setHelpPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop')

  useEffect(() => {
    // Hide entirely once installed.
    if (isStandalone()) return
    const timer = window.setTimeout(() => setHidden(false), 0)

    function onPrompt(e: Event) {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
    }
  }, [])

  if (hidden) return null

  async function handleClick() {
    onAfterTrigger()
    if (installEvent) {
      try {
        await installEvent.prompt()
        await installEvent.userChoice
      } catch {
        // user cancelled or denied — fall through to help modal
      }
      return
    }
    // No deferred prompt — surface manual instructions.
    setHelpPlatform(isIOS() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop')
    setShowHelp(true)
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={handleClick}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
      >
        <Download size={15} className="text-emerald-400" />
        Install on this device
      </button>

      {showHelp && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-emerald-700/40 bg-stone-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100">
                <Download size={15} className="text-emerald-400" />
                Install Family Vault
              </h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 text-sm text-stone-300 space-y-3">
              {helpPlatform === 'ios' && (
                <>
                  <p>On iPhone in Safari:</p>
                  <ol className="list-decimal list-outside pl-5 space-y-1 text-stone-300">
                    <li>Tap the <Share size={13} className="inline align-text-bottom text-emerald-300" /> <span className="font-semibold">Share</span> button at the bottom.</li>
                    <li>Scroll down and tap <PlusIcon size={13} className="inline align-text-bottom text-emerald-300" /> <span className="font-semibold">Add to Home Screen</span>.</li>
                    <li>Tap <span className="font-semibold">Add</span> in the top right.</li>
                  </ol>
                  <p className="text-xs text-stone-500 pt-2">
                    Note: this only works in Safari. If you&rsquo;re in Chrome or another browser
                    on iOS, switch to Safari first.
                  </p>
                </>
              )}
              {helpPlatform === 'android' && (
                <>
                  <p>On Android in Chrome:</p>
                  <ol className="list-decimal list-outside pl-5 space-y-1 text-stone-300">
                    <li>Tap the <span className="font-semibold">⋮</span> menu in the top right.</li>
                    <li>Tap <span className="font-semibold">Install app</span> (or <span className="font-semibold">Add to Home Screen</span>).</li>
                    <li>Tap <span className="font-semibold">Install</span>.</li>
                  </ol>
                  <p className="text-xs text-stone-500 pt-2">
                    If you don&rsquo;t see Install app in the menu, the browser hasn&rsquo;t
                    detected the site as installable yet — refresh the page once
                    and try again.
                  </p>
                </>
              )}
              {helpPlatform === 'desktop' && (
                <>
                  <p>On a desktop browser (Chrome/Edge/Brave):</p>
                  <ol className="list-decimal list-outside pl-5 space-y-1 text-stone-300">
                    <li>Look for an <span className="font-semibold">Install</span> icon in the right side of the address bar.</li>
                    <li>Click it and confirm <span className="font-semibold">Install</span>.</li>
                  </ol>
                  <p className="text-xs text-stone-500 pt-2">
                    Or open the browser&rsquo;s <span className="font-semibold">⋮</span> menu →
                    look for <span className="font-semibold">Install Family Vault...</span>.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
