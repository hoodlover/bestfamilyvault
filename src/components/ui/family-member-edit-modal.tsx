'use client'

// Owner-only edit modal for a single family member's profile fields.
// Opens from the pencil button on each row of the Family Info popout so
// Lance can pre-fill phone / SSN / DL / passport / anniversary / address
// for family members who don't know their own info yet. Backed by
// updateFamilyMemberProfile (owner-gated server action).
//
// Renders via createPortal to document.body — the trigger lives inside an
// <li> with hover:brightness-110, and `filter` on an ancestor establishes
// a new containing block that traps position: fixed descendants. Without
// the portal the modal gets constrained to the row's box and flickers
// every time the mouse leaves the row (hover drops → filter clears → modal
// snaps to viewport → mouse re-enters → trap again).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { updateFamilyMemberProfile } from '@/lib/actions/settings'
import { PhoneField, SsnField } from './copyable-fields'
import type { FamilyVital } from '@/lib/family-vitals'
import { pushModal } from '@/lib/modal-stack'

interface Props {
  vital: FamilyVital
  /** Tone colours from family-info-tile so the modal header matches the
   *  row the user just tapped (Gold for Lance, Maroon for Heather, etc.). */
  toneColor: string
  onClose: () => void
}

export function FamilyMemberEditModal({ vital, toneColor, onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  // True once the user has typed/changed anything in the form. Drives
  // both the click-outside guard (confirm before losing work) and Esc.
  const [dirty, setDirty] = useState(false)

  // Wait for client mount before portaling — document is undefined during
  // the SSR render pass on initial hydration.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Confirm-before-close — Lance reported losing field input when the
  // backdrop closed the modal accidentally. We only prompt when there's
  // actually unsaved input; an immediate close (untouched form) skips the
  // prompt to avoid friction.
  function attemptClose() {
    if (!dirty) {
      onClose()
      return
    }
    const ok = window.confirm('Discard your unsaved changes?')
    if (ok) onClose()
  }

  // Refs so the modal-stack callback (registered exactly once at mount)
  // always sees the latest dirty + onClose. Without this, the back-press
  // handler would close over the FIRST render's values and skip the
  // discard prompt even after the user has typed something.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Register on the modal stack so the device's hardware back gesture
  // closes the edit form first (before falling back to family info
  // popout, then BackGuard). Mounts once — the close callback reads the
  // refs above so it stays current across renders.
  useEffect(() => {
    return pushModal(() => {
      if (!dirtyRef.current) {
        onCloseRef.current()
        return
      }
      const ok = window.confirm('Discard your unsaved changes?')
      if (ok) onCloseRef.current()
    })
  }, [])

  // Block scroll + handle Escape — same pattern the parent popout uses.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') attemptClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
    // attemptClose closes over dirty + onClose; both are stable across
    // renders for our needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, onClose])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await updateFamilyMemberProfile(vital.userId!, formData)
    setLoading(false)
    if (result?.error) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  let content: React.ReactNode
  if (vital.userId == null) {
    // Pre-join slot — no users row exists for them yet, so there's
    // nothing for the action to update. Surface the why so Lance can
    // either invite them or wait until they join.
    content = (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-6 bg-stone-950/80 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-stone-600/60 bg-stone-900 shadow-2xl p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-stone-100">Edit {vital.displayName}&rsquo;s profile</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 p-1.5 text-stone-400 hover:text-stone-100 rounded-md hover:bg-stone-800/60 transition"
            >
              <X size={18} />
            </button>
          </div>
          <p className="text-sm text-stone-300 leading-relaxed">
            {vital.displayName} hasn&rsquo;t signed in yet, so there&rsquo;s no profile row to edit.
            Once they accept their invite, their row here becomes editable.
          </p>
        </div>
      </div>
    )
  } else {
    content = (
      <div
        className="fixed inset-0 z-[60] flex items-start md:items-center justify-center p-3 md:p-6 bg-stone-950/80 backdrop-blur-md overflow-y-auto"
        onClick={attemptClose}
      >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-600/60 bg-stone-900 shadow-2xl my-6 md:my-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-stone-700/60 rounded-t-2xl"
          style={{ background: `linear-gradient(135deg, ${toneColor}26 0%, ${toneColor}10 100%)` }}
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.16em] text-stone-400">Edit profile</p>
            <h2 className="text-lg md:text-xl font-bold text-stone-100 truncate" style={{ color: toneColor }}>
              {vital.displayName}
            </h2>
          </div>
          <button
            type="button"
            onClick={attemptClose}
            aria-label="Close"
            className="shrink-0 p-1.5 text-stone-400 hover:text-stone-100 rounded-md hover:bg-stone-800/60 transition"
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          onInput={() => { if (!dirty) setDirty(true) }}
          className="px-4 md:px-5 py-4 space-y-3.5"
        >
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">Display name</label>
            <input
              name="name"
              required
              defaultValue={vital.displayName}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">Birthday</label>
              <input
                name="dateOfBirth"
                type="date"
                defaultValue={vital.dateOfBirth ?? ''}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
            {vital.isParent && (
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1">Anniversary</label>
                <input
                  name="anniversary"
                  type="date"
                  defaultValue={vital.anniversary ?? ''}
                  className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
                />
              </div>
            )}
          </div>

          <PhoneField name="phone" defaultValue={vital.phone ?? ''} label="Phone" />

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">Address</label>
            <textarea
              name="address"
              rows={2}
              defaultValue={vital.address ?? ''}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition resize-y"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SsnField name="ssn" defaultValue={vital.ssn ?? ''} label="SSN" />
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">Driver&rsquo;s License #</label>
              <input
                name="driversLicense"
                defaultValue={vital.driversLicense ?? ''}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">DL expires</label>
              <input
                name="driversLicenseExpiry"
                type="date"
                defaultValue={vital.driversLicenseExpiry ?? ''}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">Passport #</label>
              <input
                name="passport"
                defaultValue={vital.passport ?? ''}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={attemptClose}
              className="px-4 py-2 text-sm text-stone-300 hover:text-stone-100 rounded-lg hover:bg-stone-800/60 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="py-2 px-5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 text-white text-sm font-medium rounded-lg transition"
            >
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
    )
  }

  if (!mounted) return null
  return createPortal(content, document.body)
}
