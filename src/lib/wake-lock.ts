// Tiny wrapper around the Screen Wake Lock API. Used during long-running
// uploads (e.g. multi-minute video letters) so the screen doesn't sleep
// and suspend the browser tab mid-stream.
//
// Browser support: Chrome / Edge / Android Chrome / iOS Safari 16.4+.
// Older browsers no-op silently — the API just isn't there.

// The TS lib doesn't ship Wake Lock types in older versions, so type the
// surface we care about ourselves rather than wrestling lib.dom.
interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function getApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any
  return nav.wakeLock ?? null
}

/**
 * Acquire a screen wake lock. Returns the sentinel (or null if the API
 * isn't supported / the request fails). Caller must release it with
 * releaseWakeLock when done.
 */
export async function acquireWakeLock(): Promise<WakeLockSentinelLike | null> {
  const api = getApi()
  if (!api) return null
  try {
    return await api.request('screen')
  } catch {
    // User backgrounded the page, OS denied, etc. — non-fatal.
    return null
  }
}

export async function releaseWakeLock(sentinel: WakeLockSentinelLike | null) {
  if (!sentinel || sentinel.released) return
  try {
    await sentinel.release()
  } catch {
    // No-op — we're cleaning up.
  }
}
