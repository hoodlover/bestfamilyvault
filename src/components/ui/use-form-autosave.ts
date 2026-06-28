'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseFormAutosaveOpts<TResult> {
  /** Called on the autosave timer when the form is dirty. Should perform the
   *  update and return whatever your server action returns. */
  save: (formData: FormData) => Promise<TResult>
  /** Decides whether the result counted as a successful save. Return true to
   *  keep the form marked dirty (e.g., the action returned an error). */
  isError: (result: TResult) => boolean
  /** Autosave cadence. Defaults to 30 seconds — short enough that the
   *  user doesn't lose work to a phone screen turning off before the
   *  next tick. Pass a longer interval for low-stakes forms. */
  intervalMs?: number
}

interface UseFormAutosaveReturn {
  /** Attach to your <form ref={formRef}> so the hook can extract FormData. */
  formRef: React.RefObject<HTMLFormElement | null>
  /** True while the form has unsaved edits since the last save. */
  dirty: boolean
  /** Timestamp of the most recent successful save (manual OR autosave). */
  lastSavedAt: Date | null
  /** Attach to <form onChange={onFormChange}> so any input change marks dirty. */
  onFormChange: () => void
  /** Call after a manual successful submit to mark the form clean. */
  markClean: () => void
}

/**
 * Tracks dirty state on an edit form, autosaves every `intervalMs` if dirty,
 * and warns the user before they leave the page with unsaved edits.
 *
 * Usage:
 *   const { formRef, dirty, lastSavedAt, onFormChange, markClean } =
 *     useFormAutosave({ save: (fd) => updateNote(id, fd), isError: r => !!r?.error })
 *
 *   <form ref={formRef} onChange={onFormChange} onSubmit={...}>
 *
 * After your manual onSubmit succeeds, call `markClean()`. The hook handles
 * the rest — periodic background save, the beforeunload guard, and the
 * "Auto-saved at HH:MM" timestamp you can show in the UI.
 */
export function useFormAutosave<TResult>(
  opts: UseFormAutosaveOpts<TResult>
): UseFormAutosaveReturn {
  const { save, isError, intervalMs = 30 * 1000 } = opts

  const formRef = useRef<HTMLFormElement | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // Refs that mirror state so we can read them inside long-lived listeners
  // without retriggering effect setup on every render.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const saveRef = useRef(save)
  saveRef.current = save
  const isErrorRef = useRef(isError)
  isErrorRef.current = isError

  // Warn if the user tries to navigate away or close the tab with unsaved edits.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      e.preventDefault()
      // Older browsers (Firefox, Safari) require returnValue to be set; newer
      // ones use e.preventDefault() but ignore the actual string.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Periodic autosave.
  useEffect(() => {
    const id = setInterval(async () => {
      if (!dirtyRef.current || !formRef.current) return
      const fd = new FormData(formRef.current)
      try {
        const result = await saveRef.current(fd)
        if (!isErrorRef.current(result)) {
          setDirty(false)
          setLastSavedAt(new Date())
        }
      } catch {
        // Network blip — leave form marked dirty so the next tick or manual
        // save retries.
      }
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const onFormChange = useCallback(() => {
    if (!dirtyRef.current) setDirty(true)
  }, [])

  const markClean = useCallback(() => {
    setDirty(false)
    setLastSavedAt(new Date())
  }, [])

  return { formRef, dirty, lastSavedAt, onFormChange, markClean }
}

/** Format a Date as a short time like "3:42 PM" for the autosave indicator. */
export function formatSavedAt(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
