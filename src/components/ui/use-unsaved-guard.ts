'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Minimal "warn before leaving with unsaved edits" hook for new-entry / new-note
 * forms. The edit forms get this for free via useFormAutosave — this is the
 * stripped-down version for forms that don't need autosave.
 *
 * Usage:
 *   const { dirty, markDirty, markClean } = useUnsavedGuard()
 *   <form onChange={markDirty} onSubmit={async (e) => { ...; markClean(); router.push(...) }}>
 *
 * Call markClean() right before router.push so the beforeunload listener
 * doesn't fire on the post-save navigation.
 */
export function useUnsavedGuard() {
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(dirty)

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true
      setDirty(true)
    }
  }, [])

  const markClean = useCallback(() => {
    dirtyRef.current = false
    setDirty(false)
  }, [])

  return { dirty, markDirty, markClean }
}
