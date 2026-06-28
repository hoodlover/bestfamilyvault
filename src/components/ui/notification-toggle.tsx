'use client'

// Settings-page tile for opting in to Web Push reminders.
//
// State machine the user walks through on first enable:
//   1. ask browser for Notification permission (system prompt)
//   2. tell the SW's pushManager to subscribe (returns a PushSubscription
//      object — endpoint + keys)
//   3. POST that subscription to /api/push/subscribe so the server can
//      reach this device later
//
// On disable: unsubscribe locally THEN tell the server, so a network
// failure doesn't leave the user thinking they're unsubscribed when
// they aren't.
//
// iOS caveat: Web Push only works on iOS 16.4+ AND only for PWAs
// installed to the home screen. We detect both and show install copy
// rather than a non-functional toggle.

import { useEffect, useState } from 'react'
import { Bell, BellOff, Send, Smartphone } from 'lucide-react'

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'needs-install' }
  | { kind: 'denied' }
  | { kind: 'idle' }            // supported, permission default, not subscribed
  | { kind: 'subscribed'; endpoint: string }

export function NotificationToggle() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => { void detectState().then(setState) }, [])

  async function enable() {
    setBusy(true)
    setTestResult(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState({ kind: 'denied' })
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast — the TS lib types narrowed to `BufferSource & { buffer: ArrayBuffer }`
        // in recent releases, but real browsers accept any Uint8Array.
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ kind: 'subscribed', endpoint: sub.endpoint })
    } catch (err) {
      console.error('[push] enable failed', err)
      alert('Could not enable notifications: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setTestResult(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setState({ kind: 'idle' })
    } catch (err) {
      console.error('[push] disable failed', err)
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setBusy(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data: { total?: number; sent?: number; failed?: number } = await res.json()
      if (data.sent && data.sent > 0) {
        setTestResult(`Sent to ${data.sent} device${data.sent === 1 ? '' : 's'} — check your screen.`)
      } else {
        setTestResult(`No devices reached. ${data.failed ? `(${data.failed} failed)` : ''}`)
      }
    } catch (err) {
      setTestResult('Failed to send: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-stone-500">Checking notification support…</p>
  }

  if (state.kind === 'unsupported') {
    return (
      <div className="text-sm text-stone-400 space-y-2">
        <p>Push notifications aren&rsquo;t supported on this browser.</p>
        <p className="text-xs text-stone-500">{state.reason}</p>
      </div>
    )
  }

  if (state.kind === 'needs-install') {
    return (
      <div className="text-sm text-stone-300 space-y-2">
        <div className="flex items-start gap-2">
          <Smartphone size={16} className="text-stone-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-stone-200">Install the app first</p>
            <p className="text-xs text-stone-500 mt-1">
              iOS only delivers push notifications to installed PWAs. In Safari, tap the share icon
              → <span className="font-medium text-stone-300">Add to Home Screen</span>, then open
              Family Vault from your home screen and come back here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'denied') {
    return (
      <div className="text-sm text-stone-300 space-y-2">
        <p className="text-stone-300">Notifications are blocked in your browser settings.</p>
        <p className="text-xs text-stone-500">
          Re-enable for cobbvault.com in your browser&rsquo;s site settings, then reload.
        </p>
      </div>
    )
  }

  if (state.kind === 'idle') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-stone-300">
          Get a heads-up 3 days before each recurring charge, and a nudge when statements should be downloaded.
        </p>
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 text-white rounded-lg transition"
        >
          <Bell size={14} />
          {busy ? 'Enabling…' : 'Enable reminders'}
        </button>
      </div>
    )
  }

  // subscribed
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-300 flex items-center gap-2">
        <Bell size={14} className="text-green-400" />
        Reminders are on for this device.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sendTest}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-200 rounded-lg transition"
        >
          <Send size={13} />
          Send test
        </button>
        <button
          type="button"
          onClick={disable}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 rounded-lg transition"
        >
          <BellOff size={13} />
          Turn off
        </button>
      </div>
      {testResult && <p className="text-xs text-stone-400">{testResult}</p>}
    </div>
  )
}

async function detectState(): Promise<State> {
  if (typeof window === 'undefined') return { kind: 'loading' }

  // Detect iOS standalone (PWA) requirement.
  const ua = navigator.userAgent
  const isIos = /iPhone|iPad|iPod/.test(ua)
  // iOS standalone: navigator.standalone === true (Safari) or display-mode:standalone (Chrome).
  const isStandalone =
    (window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as { standalone?: boolean }).standalone === true
  if (isIos && !isStandalone) return { kind: 'needs-install' }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { kind: 'unsupported', reason: 'This browser is missing Notification, ServiceWorker, or PushManager.' }
  }
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return { kind: 'unsupported', reason: 'Server VAPID key is missing.' }
  }

  if (Notification.permission === 'denied') return { kind: 'denied' }

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) return { kind: 'subscribed', endpoint: sub.endpoint }
  return { kind: 'idle' }
}

// Convert the standard VAPID public key (URL-safe base64) into the
// Uint8Array PushManager.subscribe() expects.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}
