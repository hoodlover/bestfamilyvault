'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Calls router.refresh() when the user returns to the tab or the window
 * regains focus. Server components on the current route re-fetch their data,
 * so cards/lists pick up edits the user made in another tab or just minutes
 * ago without forcing a manual reload.
 *
 * Throttled to once every 5 seconds to avoid hammering on rapid focus blips.
 */
export function RefreshOnFocus() {
  const router = useRouter()
  const lastRefresh = useRef(0)

  useEffect(() => {
    function maybeRefresh() {
      const now = Date.now()
      if (now - lastRefresh.current < 5_000) return
      lastRefresh.current = now
      router.refresh()
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') maybeRefresh()
    }

    window.addEventListener('focus', maybeRefresh)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('focus', maybeRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router])

  return null
}
