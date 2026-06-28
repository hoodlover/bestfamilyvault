'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { signOut } from 'next-auth/react'
import { UserRound, Settings, ArrowUpCircle, X, CheckCircle2, Inbox, BookOpen, Heart, Hourglass, ShieldCheck, Lightbulb, Send } from 'lucide-react'
import { requestUpgrade } from '@/lib/actions/upgrade-requests'
import { submitFeatureRequest } from '@/lib/actions/feature-requests'
import { InstallAppMenuItem } from './install-app-menu-item'

interface Props {
  name: string | null
  email: string | null
  image: string | null
  role: string
  unreadCount?: number
}

export function UserMenu({ name, email, image, role, unreadCount = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showFeatureModal, setShowFeatureModal] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = (name ?? email ?? '?').trim().charAt(0).toUpperCase() || '?'
  const showUpgrade = role !== 'superuser'
  const showAdmin = role === 'superuser' || role === 'admin'

  return (
    <>
      <div ref={ref} className="fixed top-3 right-3 z-40 md:top-4 md:right-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Open user menu"
          aria-expanded={open}
          className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-stone-700 bg-stone-800 shadow-lg transition hover:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-stone-200">{initial}</span>
          )}
          {unreadCount > 0 && (
            // Small red dot at the bottom-left of the avatar — the previous
            // top-right green pill was visually flush with the screen edge and
            // hard to spot against busy backgrounds.
            <span
              aria-label={`${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`}
              title={`${unreadCount} unread`}
              className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-stone-900"
            />
          )}
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-60 rounded-xl border border-stone-700 bg-stone-900/95 backdrop-blur shadow-2xl py-1.5"
          >
            <div className="px-3 py-2 border-b border-stone-800">
              <div className="text-sm font-semibold text-stone-100 truncate">{name ?? email ?? 'User'}</div>
              {email && name && <div className="text-xs text-stone-500 truncate">{email}</div>}
              <div className="mt-1 text-[10px] uppercase tracking-wider text-stone-500">{role}</div>
            </div>

            {role !== 'readonly' && (
              <Link
                href="/my-vault"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
              >
                <UserRound size={15} className="text-amber-400" />
                My Vault
              </Link>
            )}

            <Link
              href="/messages"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <Inbox size={15} className="text-emerald-400" />
              <span className="flex-1">Messages</span>
              {unreadCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-stone-950">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>

            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <Settings size={15} className="text-stone-400" />
              My Settings
            </Link>

            <Link
              href="/guide"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <BookOpen size={15} className="text-sky-400" />
              Guide
            </Link>

            <Link
              href="/capsules"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <Hourglass size={15} className="text-amber-400" />
              Time Capsules
            </Link>

            <Link
              href="/letters"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <Heart size={15} className="text-pink-400 fill-pink-400" />
              Family Letters
            </Link>

            {showAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
              >
                <ShieldCheck size={15} className="text-purple-400" />
                Admin Panel
              </Link>
            )}

            <InstallAppMenuItem onAfterTrigger={() => setOpen(false)} />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setShowFeatureModal(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
            >
              <Lightbulb size={15} className="text-amber-400" />
              Request a Feature
            </button>

            {showUpgrade && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setShowUpgradeModal(true)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-stone-300 hover:bg-stone-800 hover:text-stone-100"
              >
                <ArrowUpCircle size={15} className="text-emerald-400" />
                Request Upgrade
              </button>
            )}

            <div className="my-1 border-t border-stone-800" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                signOut({ callbackUrl: '/login' })
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-400 hover:bg-stone-800 hover:text-red-400"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/cobb/icons/system/sign_out.png" width={21} height={21} alt="" className="h-[21px] w-[21px] object-contain" />
              Log Out
            </button>
          </div>
        )}
      </div>

      {showUpgradeModal && (
        <UpgradeRequestModal
          currentRole={role}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}

      {showFeatureModal && (
        <FeatureRequestModal onClose={() => setShowFeatureModal(false)} />
      )}
    </>
  )
}

function FeatureRequestModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fd = new FormData()
    fd.append('message', message)
    const result = await submitFeatureRequest(fd)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-100">
            <Lightbulb size={18} className="text-amber-400" />
            Request a Feature
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <p className="text-stone-200 font-medium">Sent.</p>
            <p className="text-sm text-stone-400">Your vault admin gets your idea in their inbox.</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg transition"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <p className="text-sm text-stone-400">
              One-liner is fine — what would you like to see added or changed in the vault?
            </p>
            <textarea
              required
              autoFocus
              rows={4}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="E.g. add a button to mark a card as recurring…"
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            />
            <p className="text-xs text-stone-500 text-right">{message.length} / 4000</p>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-700 hover:bg-amber-600 disabled:bg-amber-900 disabled:opacity-60 text-white rounded-lg transition"
              >
                {busy ? (
                  <>
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Send to admin
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

interface ModalProps {
  currentRole: string
  onClose: () => void
}

function UpgradeRequestModal({ currentRole, onClose }: ModalProps) {
  const [message, setMessage] = useState('')
  const [requestedRole, setRequestedRole] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const fd = new FormData()
    fd.append('message', message)
    if (requestedRole) fd.append('requestedRole', requestedRole)
    const result = await requestUpgrade(fd)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  // Suggest the next step up from current role
  const roleOptions = (() => {
    if (currentRole === 'readonly') return ['member', 'admin']
    if (currentRole === 'member') return ['admin']
    if (currentRole === 'admin') return [] // can't go higher than admin via this flow
    return ['member']
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-100">
            <ArrowUpCircle size={18} className="text-emerald-400" />
            Request Upgrade
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <p className="text-stone-200 font-medium">Request sent!</p>
            <p className="text-sm text-stone-400">An admin will see this in their Admin Panel.</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg transition"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <p className="text-sm text-stone-400">
              Send a note to the family-vault admins. Your current role is{' '}
              <span className="text-stone-200 font-medium uppercase tracking-wider">{currentRole}</span>.
            </p>

            {roleOptions.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                  Role you want
                </label>
                <select
                  value={requestedRole}
                  onChange={(e) => setRequestedRole(e.target.value)}
                  className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
                >
                  <option value="">No preference — admins decide</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                Message
              </label>
              <textarea
                required
                rows={4}
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Why would you like an upgrade?"
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
              />
              <p className="mt-1 text-xs text-stone-500">{message.length} / 1000</p>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !message.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
              >
                {busy ? (
                  <>
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send request'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
