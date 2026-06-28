'use client'

// Per-user contacts list. Search + add + edit + delete. Each mutation is
// a server action that marks the row for push to Gmail on the next sync;
// the user can also tap "Sync now" to flush + pull immediately.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HelpPopout } from './help-popout'
import {
  ArrowLeft, Building2, Cake, Link2, Mail, MapPin, MessageSquare, Phone, Plus, RefreshCw,
  Search, Sparkles, Star, Trash2, X,
} from 'lucide-react'
import {
  createContactLocal,
  deleteContactLocal,
  normalizeMyContacts,
  setContactFavorite,
  triggerSyncNow,
  updateContactLocal,
  type ContactRow,
} from '@/lib/actions/gmail-contacts'

interface Props {
  initialContacts: ContactRow[]
  link: {
    linked: boolean
    gmailEmail: string | null
    syncFrequency: string
    lastSyncedAt: Date | null
  }
}

export function ContactsList({ initialContacts, link }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<ContactRow | 'new' | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  // Per-row star overlay. Tapping the star flips the local override
  // immediately (re-sort happens on next render); the server call goes
  // out in the background. Stays as a Map so toggles don't lose
  // pending in-flight values.
  const [favOverrides, setFavOverrides] = useState<Map<string, boolean>>(new Map())

  function isFav(c: ContactRow): boolean {
    return favOverrides.get(c.id) ?? c.isFavorite
  }

  function toggleFav(c: ContactRow, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const next = !isFav(c)
    setFavOverrides((prev) => {
      const m = new Map(prev)
      m.set(c.id, next)
      return m
    })
    setContactFavorite(c.id, next).then((res) => {
      if ('error' in res && res.error) {
        // Roll the overlay back if the server rejected.
        setFavOverrides((prev) => {
          const m = new Map(prev)
          m.delete(c.id)
          return m
        })
      } else {
        startTransition(() => router.refresh())
      }
    })
  }

  // Deep-link: `?contact=<id>` auto-opens that contact's card on mount
  // (used by the global search to jump straight from a result into the
  // edit modal). Stripping the param from the URL after open prevents
  // the modal from re-popping if the user closes it and the page
  // re-renders. Only fires once per id-change.
  const targetContactId = searchParams.get('contact')
  useEffect(() => {
    if (!targetContactId) return
    const match = initialContacts.find((c) => c.id === targetContactId)
    if (match) setEditing(match)
    // Clear the param so closing the modal doesn't re-open it.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('contact')
    const qs = params.toString()
    router.replace(qs ? `/contacts?${qs}` : '/contacts', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetContactId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = !q
      ? initialContacts
      : initialContacts.filter((c) => {
          const hay = [
            c.displayName,
            c.givenName,
            c.familyName,
            c.organization,
            ...c.emails.map((e) => e.value),
            ...c.phones.map((p) => p.value),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          return hay.includes(q)
        })
    // Re-sort with the optimistic favorites overlay applied — server's
    // order is already isFavorite desc → name asc, but a freshly-toggled
    // star needs to float NOW, not after the router.refresh() lands.
    // Stable sort: only re-order items whose effective fav state differs.
    return [...matches].sort((a, b) => {
      const af = isFav(a) ? 1 : 0
      const bf = isFav(b) ? 1 : 0
      if (af !== bf) return bf - af
      return 0
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isFav captures favOverrides; recomputing on either drives the sort
  }, [query, initialContacts, favOverrides])

  async function cleanUp() {
    if (!confirm('Clean up your contacts? This dedupes emails + phones and reformats addresses to street / city, state zip / country. Changes are queued to push to Gmail on next sync.')) return
    setCleaning(true)
    setSyncMessage(null)
    const res = await normalizeMyContacts()
    setCleaning(false)
    if ('error' in res) {
      setSyncMessage(res.error)
      return
    }
    setSyncMessage(`Cleaned up ${res.modified} of ${res.scanned} contact${res.scanned === 1 ? '' : 's'}.`)
    router.refresh()
  }

  async function syncNow() {
    setSyncing(true)
    setSyncMessage(null)
    const res = await triggerSyncNow()
    setSyncing(false)
    if ('error' in res && res.error) {
      setSyncMessage(res.error)
    } else if ('outcome' in res && res.outcome) {
      const o = res.outcome
      const total = o.pushedCreated + o.pushedUpdated + o.pushedDeleted + o.pulledUpserted + o.pulledDeleted
      setSyncMessage(
        total === 0
          ? 'Up to date.'
          : `Synced — pushed ${o.pushedCreated + o.pushedUpdated + o.pushedDeleted}, pulled ${o.pulledUpserted + o.pulledDeleted}.`
      )
      router.refresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/contacts.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 object-contain shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold text-stone-100">Contacts</h1>
              <HelpPopout
                title="Contacts"
                sections={[
                  {
                    heading: 'What this is',
                    tips: [
                      { title: 'Family directory', description: 'People + organizations the family interacts with — doctors, schools, lawyers, neighbors, business contacts.' },
                      { title: 'Linked to Gmail', description: 'Connect your Google account and contacts sync over. Each user gets their own link; you only see contacts from your own Gmail.' },
                    ],
                  },
                  {
                    heading: 'Link Gmail',
                    tips: [
                      { title: 'One-time grant', description: 'OAuth flow with read-only contacts scope. Tokens encrypted at rest.' },
                      { title: 'Manual resync', description: 'Re-syncs nightly automatically; force one from this page if you just added someone in Gmail.' },
                    ],
                  },
                  {
                    heading: 'Use a contact',
                    tips: [
                      { title: 'Search', description: 'Filter the list by name, email, or phone.' },
                      { title: 'Tap to call/email', description: 'Phone numbers tap-to-call; emails open your mail client. Long-press to copy.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              {link.linked ? (
                <>
                  Synced with <span className="text-emerald-300">{link.gmailEmail}</span>
                  {link.lastSyncedAt && <> · last sync {formatTime(link.lastSyncedAt)}</>}
                </>
              ) : (
                'Connect Gmail in Settings to import + sync your address book.'
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {initialContacts.length > 0 && (
            <button
              type="button"
              onClick={cleanUp}
              disabled={cleaning || syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-amber-900/30 border border-stone-700 hover:border-amber-700/50 text-stone-300 hover:text-amber-200 rounded-lg transition disabled:opacity-60"
              title="Dedupe emails + phones; reformat addresses"
            >
              <Sparkles size={13} className={cleaning ? 'animate-pulse' : ''} />
              {cleaning ? 'Cleaning…' : 'Clean up'}
            </button>
          )}
          {link.linked && (
            <button
              type="button"
              onClick={syncNow}
              disabled={syncing || cleaning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 rounded-lg transition disabled:opacity-60"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
          >
            <Plus size={13} />
            Add contact
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="text-xs bg-stone-900/50 border border-stone-800 rounded-lg px-3 py-2 space-y-2">
          <p className={needsReconnect(syncMessage) ? 'text-red-300' : 'text-stone-400'}>
            {syncMessage}
          </p>
          {needsReconnect(syncMessage) && (
            <a
              href="/api/google/connect/start"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
            >
              <Link2 size={12} />
              Reconnect Gmail
            </a>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts…"
          className="w-full pl-9 pr-3 py-2.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 placeholder-stone-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-500">
          {initialContacts.length === 0
            ? link.linked
              ? 'No contacts yet. Tap "Sync now" to pull them from Gmail.'
              : 'Add a contact above, or connect Gmail in Settings.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="rounded-xl border border-stone-700/60 overflow-hidden bg-stone-900/40 divide-y divide-stone-800">
          {filtered.map((c) => {
            // First phone / email drive the quick-action buttons next to
            // the row. Dial string strips formatting so tel:/sms: schemes
            // get clean digits; mailto: gets the raw email value.
            const firstPhone = c.phones[0]?.value?.trim() || null
            const firstEmail = c.emails[0]?.value?.trim() || null
            const dialNumber = firstPhone ? firstPhone.replace(/[^\d+]/g, '') : null
            return (
              <li key={c.id} className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-stone-800/60 transition"
                >
                  <div className="text-sm font-semibold text-stone-100 truncate">
                    {c.displayName || [c.givenName, c.familyName].filter(Boolean).join(' ') || '(no name)'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 flex-wrap text-xs text-stone-500 truncate">
                    {firstEmail && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Mail size={11} /> {firstEmail}
                      </span>
                    )}
                    {firstPhone && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Phone size={11} /> {firstPhone}
                      </span>
                    )}
                    {c.organization && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Building2 size={11} /> {c.organization}
                      </span>
                    )}
                    {c.syncStatus !== 'synced' && (
                      <span className="text-amber-400 italic">(pending sync)</span>
                    )}
                  </div>
                </button>
                {/* Star + quick actions on the row itself. The star is
                    always rendered (so contacts without a phone/email can
                    still be favorited); call / text / email show only
                    when there's something to dial / write to. */}
                <div className="flex items-center gap-1 pr-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => toggleFav(c, e)}
                    aria-pressed={isFav(c)}
                    aria-label={isFav(c) ? 'Unstar contact' : 'Star contact'}
                    title={isFav(c) ? 'Starred — tap to unstar' : 'Star to float to the top'}
                    className={`inline-flex items-center justify-center h-9 w-9 rounded-md transition ${
                      isFav(c) ? 'text-[#d8a531]' : 'text-stone-600 hover:text-stone-300'
                    }`}
                  >
                    <Star size={14} className={isFav(c) ? 'fill-[#d8a531]' : ''} />
                  </button>
                  {dialNumber && (
                    <a
                      href={`tel:${dialNumber}`}
                      aria-label={`Call ${firstPhone}`}
                      title="Call"
                      className="inline-flex items-center justify-center h-9 w-9 rounded-md text-emerald-300 hover:bg-emerald-700/40 transition"
                    >
                      <Phone size={14} />
                    </a>
                  )}
                  {dialNumber && (
                    <a
                      href={`sms:${dialNumber}`}
                      aria-label={`Text ${firstPhone}`}
                      title="Text"
                      className="inline-flex items-center justify-center h-9 w-9 rounded-md text-sky-300 hover:bg-sky-700/40 transition"
                    >
                      <MessageSquare size={14} />
                    </a>
                  )}
                  {firstEmail && (
                    <a
                      href={`mailto:${firstEmail}`}
                      aria-label={`Email ${firstEmail}`}
                      title="Email"
                      className="inline-flex items-center justify-center h-9 w-9 rounded-md text-amber-300 hover:bg-amber-700/40 transition"
                    >
                      <Mail size={14} />
                    </a>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <ContactEditor
          mode={editing === 'new' ? 'new' : 'edit'}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            startTransition(() => router.refresh())
          }}
        />
      )}
    </div>
  )
}

function formatTime(d: Date): string {
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// Token-level Google errors the user can only fix by reconnecting: refresh
// token revoked/expired (publishing-status flip, manual revoke at
// myaccount.google.com), or the consent grant is missing the contacts scope.
function needsReconnect(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('invalid_grant') ||
    m.includes('expired or revoked') ||
    m.includes('token refresh failed') ||
    m.includes('access_token_scope_insufficient') ||
    m.includes('insufficient authentication scopes') ||
    m.includes('permission_denied')
  )
}

// ─── Editor modal ───────────────────────────────────────────────────────────

interface MultiValue { value: string; type?: string }

function ContactEditor({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'new' | 'edit'
  initial: ContactRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  const [givenName, setGivenName] = useState(initial?.givenName ?? '')
  const [familyName, setFamilyName] = useState(initial?.familyName ?? '')
  const [emails, setEmails] = useState<MultiValue[]>(initial?.emails?.length ? initial.emails.map((e) => ({ value: e.value, type: e.type ?? undefined })) : [{ value: '' }])
  const [phones, setPhones] = useState<MultiValue[]>(initial?.phones?.length ? initial.phones.map((p) => ({ value: p.value, type: p.type ?? undefined })) : [{ value: '' }])
  const [organization, setOrganization] = useState(initial?.organization ?? '')
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? '')
  const [birthday, setBirthday] = useState(initial?.birthday ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [address, setAddress] = useState(initial?.addresses?.[0]?.value ?? '')

  async function save() {
    setBusy(true)
    setError(null)
    const payload = {
      givenName,
      familyName,
      displayName: [givenName, familyName].filter(Boolean).join(' ') || null,
      emails: emails.map((e) => ({ value: e.value })).filter((e) => e.value.trim() !== ''),
      phones: phones.map((p) => ({ value: p.value })).filter((p) => p.value.trim() !== ''),
      addresses: address.trim() ? [{ value: address.trim() }] : [],
      organization,
      jobTitle,
      birthday,
      notes,
    }
    const res = mode === 'new'
      ? await createContactLocal(payload)
      : await updateContactLocal(initial!.id, payload)
    setBusy(false)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    onSaved()
  }

  async function del() {
    if (!initial) return
    if (!confirm(`Delete ${initial.displayName || 'this contact'}? It will be removed from Gmail on the next sync too.`)) return
    setBusy(true)
    const res = await deleteContactLocal(initial.id)
    setBusy(false)
    if ('error' in res && res.error) { setError(res.error); return }
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <form
        ref={formRef}
        onSubmit={(e) => { e.preventDefault(); save() }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            {/* Explicit Back affordance — the modal already closes on X /
                backdrop / Esc, but on mobile the modal is effectively a
                full-screen view, so an ARROW-LEFT chip at the leading
                edge reads as "back to the list" without the user having
                to hunt for the close-X. */}
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Back to contacts"
              title="Back to contacts"
              className="inline-flex items-center gap-1 px-2 py-1 -ml-1 rounded text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition text-sm"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back</span>
            </button>
            <h2 className="text-base font-semibold text-stone-100 truncate">
              {mode === 'new' ? 'New contact' : 'Edit contact'}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:opacity-60 text-white rounded-lg transition shadow-md"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="p-1.5 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" value={givenName} onChange={setGivenName} autoCapitalize="words" />
            <Field label="Last name" value={familyName} onChange={setFamilyName} autoCapitalize="words" />
          </div>

          <MultiField
            label="Email"
            icon={<Mail size={13} />}
            values={emails}
            setValues={setEmails}
            inputType="email"
            placeholder="name@example.com"
          />

          <MultiField
            label="Phone"
            icon={<Phone size={13} />}
            values={phones}
            setValues={setPhones}
            inputType="tel"
            placeholder="000.000.0000"
          />

          <Field label="Organization" value={organization} onChange={setOrganization} icon={<Building2 size={13} />} />
          <Field label="Job title" value={jobTitle} onChange={setJobTitle} />
          {/* Address gets a multi-line box so the user can format it the
              way they read it: street on line 1, city + state + zip on
              line 2 (or however they want). Newlines are preserved
              through to Gmail's `formattedValue` field and back. */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
              <MapPin size={13} />
              Address
            </label>
            <textarea
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={`123 Main St\nCity, State 30301`}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 resize-y whitespace-pre-line"
            />
            <p className="mt-1 text-[11px] text-stone-500">Press Enter to wrap onto a new line.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Birthday (YYYY-MM-DD)" value={birthday} onChange={setBirthday} icon={<Cake size={13} />} placeholder="1985-04-12" />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-stone-500 mb-1">Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {mode === 'edit' && (
          <div className="flex justify-between items-center gap-2 px-5 py-3 border-t border-stone-800 shrink-0">
            <button
              type="button"
              onClick={del}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition"
            >
              <Trash2 size={13} />
              Delete
            </button>
            <span className="text-xs text-stone-500">
              Changes sync to Gmail on the next sync.
            </span>
          </div>
        )}
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  icon,
  placeholder,
  autoCapitalize,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  icon?: React.ReactNode
  placeholder?: string
  autoCapitalize?: 'words' | 'sentences'
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
        {icon}
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
      />
    </div>
  )
}

function MultiField({
  label,
  icon,
  values,
  setValues,
  inputType,
  placeholder,
}: {
  label: string
  icon: React.ReactNode
  values: MultiValue[]
  setValues: (v: MultiValue[]) => void
  inputType: 'email' | 'tel'
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-stone-500 mb-1 flex items-center gap-1">
        {icon}
        {label}
      </label>
      <div className="space-y-1.5">
        {values.map((v, i) => {
          // Phone fields get tap-to-call + tap-to-text icon links to the
          // right of the input. tel: and sms: schemes are honored by every
          // mobile browser and most desktop OSes (which open whatever
          // dialer / messaging app is registered).
          const trimmed = v.value.trim()
          const showCallText = inputType === 'tel' && trimmed !== ''
          // Strip whitespace + most punctuation for the dial string —
          // tel:/sms: are forgiving but cleaner is better.
          const dialNumber = trimmed.replace(/[^\d+]/g, '')
          return (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type={inputType}
                value={v.value}
                onChange={(e) => {
                  const next = [...values]
                  next[i] = { ...next[i], value: e.target.value }
                  setValues(next)
                }}
                placeholder={placeholder}
                className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
              />
              {showCallText && (
                <>
                  <a
                    href={`tel:${dialNumber}`}
                    aria-label={`Call ${trimmed}`}
                    title="Call"
                    className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 transition shrink-0"
                  >
                    <Phone size={14} />
                  </a>
                  <a
                    href={`sms:${dialNumber}`}
                    aria-label={`Text ${trimmed}`}
                    title="Text"
                    className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-sky-700/30 hover:bg-sky-700/50 text-sky-300 transition shrink-0"
                  >
                    <MessageSquare size={14} />
                  </a>
                </>
              )}
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => setValues(values.filter((_, j) => j !== i))}
                  aria-label="Remove"
                  className="p-1.5 text-stone-600 hover:text-red-400 transition"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => setValues([...values, { value: '' }])}
          className="text-xs text-stone-500 hover:text-emerald-400 transition"
        >
          + Add another
        </button>
      </div>
    </div>
  )
}
