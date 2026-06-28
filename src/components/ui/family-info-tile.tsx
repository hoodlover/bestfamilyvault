'use client'

// Dashboard tile + modal popover for the Family Info quick-glance view.
//
// Tile lives in the dashboard's mid-page tile grid (same look as Meal
// plan / IDNW / Cards / Contacts). Tapping it opens a centred modal
// over a blurred backdrop showing the whole family roster — name,
// phone, SSN, birthday, plus a "View card" link that deep-links to
// their identity entry (or "Create card" when nobody has made one yet).
//
// The modal is a quick-glance view: all data shown in plain text so
// Heather (or anyone in a hurry) doesn't have to tap-to-reveal. Same
// access already exists across the Identity entries Lance keeps; this
// is just the at-a-table-with-the-lawyer summary.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X, Pencil, UserPlus, Copy, Check, IdCard } from 'lucide-react'
import type { FamilyVital } from '@/lib/family-vitals'
import { FamilyMemberEditModal } from './family-member-edit-modal'
import { pushModal } from '@/lib/modal-stack'

// Per-person accent palette — every member gets one of the four CobbVault
// icon-set colours (Gold / Maroon / Navy / Forest Green) or a -lite variant.
// No off-palette accents (no rose/sky/violet/emerald/pink) so the roster
// reads as an extension of the icons. Stored as raw CSS values because
// Tailwind arb-classes don't compose with opacity modifiers cleanly for
// dynamic per-row tones.
type Tone = {
  borderColor: string
  bg: string
  nameColor: string
  pencilColor: string
  pencilBg: string
  pencilBorderColor: string
}
const PERSON_TONE: Record<string, Tone> = {
  // Lance — Gold (the marigold; matches the vault icon brand colour)
  lance:    { borderColor: 'rgb(209 138 22 / 0.75)', bg: 'rgb(209 138 22 / 0.10)', nameColor: '#F4C46B', pencilColor: '#F4C46B', pencilBg: 'rgb(154 98 8 / 0.40)',   pencilBorderColor: 'rgb(154 98 8 / 0.55)' },
  // Heather — Maroon (warmth, partner to gold)
  heather:  { borderColor: 'rgb(143 32 23 / 0.80)',  bg: 'rgb(143 32 23 / 0.12)',  nameColor: '#E89890', pencilColor: '#E89890', pencilBg: 'rgb(93 20 16 / 0.40)',   pencilBorderColor: 'rgb(93 20 16 / 0.55)' },
  // Tadan — Navy
  tadan:    { borderColor: 'rgb(24 72 111 / 0.80)',  bg: 'rgb(24 72 111 / 0.12)',  nameColor: '#8DBDDE', pencilColor: '#8DBDDE', pencilBg: 'rgb(14 45 71 / 0.45)',   pencilBorderColor: 'rgb(14 45 71 / 0.60)' },
  // Sydney — Forest Green
  sydney:   { borderColor: 'rgb(62 108 47 / 0.80)',  bg: 'rgb(62 108 47 / 0.12)',  nameColor: '#A2CD90', pencilColor: '#A2CD90', pencilBg: 'rgb(39 68 29 / 0.45)',   pencilBorderColor: 'rgb(39 68 29 / 0.60)' },
  // Makenzie — Gold-lite (lighter marigold)
  makenzie: { borderColor: 'rgb(231 178 74 / 0.80)', bg: 'rgb(231 178 74 / 0.12)', nameColor: '#FFE0A1', pencilColor: '#FFE0A1', pencilBg: 'rgb(209 138 22 / 0.35)', pencilBorderColor: 'rgb(209 138 22 / 0.55)' },
  // Paiton — Maroon-lite
  paiton:   { borderColor: 'rgb(179 58 48 / 0.80)',  bg: 'rgb(179 58 48 / 0.12)',  nameColor: '#F5BFB7', pencilColor: '#F5BFB7', pencilBg: 'rgb(143 32 23 / 0.35)',  pencilBorderColor: 'rgb(143 32 23 / 0.55)' },
}
const PERSON_TONE_FALLBACK: Tone = {
  borderColor: 'rgb(120 113 108 / 0.60)',
  bg: 'rgb(28 25 23 / 0.40)',
  nameColor: '#e7e5e4',
  pencilColor: '#e7e5e4',
  pencilBg: 'rgb(41 37 36 / 1)',
  pencilBorderColor: 'rgb(68 64 60 / 1)',
}

function personTone(displayName: string): Tone {
  return PERSON_TONE[displayName.toLowerCase()] ?? PERSON_TONE_FALLBACK
}

interface Props {
  vitals: FamilyVital[]
  /** Max users.updatedAt across the resolved roster — shows as the
   *  "Updated Last" badge in the modal header. null when no roster
   *  users have been resolved yet. */
  lastUpdated: Date | string | null
  /** "tile" (default) — full-width dashboard tile next to Where Is It.
   *  "header" — small icon-only button for the dashboard hero corner,
   *  same modal opens either way. Two instances on a page don't
   *  conflict; each owns its own open state but only one renders the
   *  modal at a time. */
  variant?: 'tile' | 'header'
  /** True when the signed-in user is the family owner (or a superuser).
   *  Drives whether per-row Edit-profile pencils render — non-owners
   *  still see the popout but can't write to other people's user rows. */
  canEditOthers?: boolean
}

export function FamilyInfoTile({ vitals, lastUpdated, variant = 'tile', canEditOthers = false }: Props) {
  const [open, setOpen] = useState(false)

  // Lock body scroll while the modal is up — same pattern the message
  // modal uses so the dashboard doesn't slide behind it.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Family Info"
          title="Family Info"
          className="shrink-0 inline-flex items-center justify-center rounded-xl hover:bg-stone-800/60 transition p-0.5 md:p-1"
        >
          {/* Mobile size shrunk from 60px → 36px so the icon visually
              pairs with the floating UserMenu avatar (h-10 = 40px) when
              this tile is mounted in the top-right corner cluster.
              Desktop size unchanged — the desktop hero still has the
              big 72px footprint. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/id_info.png"
            width={72}
            height={72}
            alt=""
            className="h-9 w-9 md:h-[72px] md:w-[72px] object-contain rounded-lg"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-stone-900/50 border border-sky-700/40 rounded-lg text-stone-200 text-sm font-medium hover:-translate-y-[5px] hover:border-sky-500/70 hover:bg-stone-800/70 hover:shadow-lg hover:shadow-black/30 focus:outline-none transition w-full text-left"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/cobb/icons/system/id_info.png"
            width={45}
            height={45}
            alt=""
            className="object-contain rounded shrink-0"
          />
          Family Info
        </button>
      )}

      {open && (
        <FamilyInfoModal
          vitals={vitals}
          lastUpdated={lastUpdated}
          canEditOthers={canEditOthers}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function FamilyInfoModal({
  vitals,
  lastUpdated,
  canEditOthers,
  onClose,
}: {
  vitals: FamilyVital[]
  lastUpdated: Date | string | null
  canEditOthers: boolean
  onClose: () => void
}) {
  const lastUpdatedLabel = formatLastUpdated(lastUpdated)
  // Inline expandable "Where this data comes from" panel — Lance asked
  // for a linkage map so it's clear which field pulls from which table
  // and where to edit each one. Collapsed by default to keep the modal
  // tight.
  const [sourcesOpen, setSourcesOpen] = useState(false)
  // Register on the modal stack so the device's hardware back gesture
  // closes the popout instead of triggering BackGuard's "Leave the vault?"
  // prompt. Ref keeps the close callback fresh without re-pushing on
  // every render (onClose is a new arrow fn from the parent each time).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    return pushModal(() => onCloseRef.current())
  }, [])
  return (
    <div
      className="fixed inset-0 z-50 flex items-start md:items-center justify-center p-3 md:p-6 bg-stone-950/70 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-stone-600/60 bg-stone-900 shadow-2xl my-6 md:my-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — vault-palette gradient strip (gold → maroon, both
            CobbVault icon colours) so the modal reads as a family
            artifact, not a spreadsheet. Layout is a two-row stack: title
            row owns icon + heading + close button; description gets the
            full header width below so it doesn't get squeezed by the
            "Updated last" badge (that now lives at the bottom of the
            description as small caption text). */}
        <div
          className="px-4 md:px-6 py-3 md:py-4 border-b border-stone-700/60 rounded-t-2xl"
          style={{
            background:
              'linear-gradient(135deg, rgb(209 138 22 / 0.22) 0%, rgb(143 32 23 / 0.18) 55%, rgb(24 72 111 / 0.18) 100%)',
          }}
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/cobb/icons/system/id_info.png"
              alt=""
              className="h-10 w-10 md:h-12 md:w-12 object-contain shrink-0"
            />
            <h2 className="flex-1 min-w-0 text-lg md:text-xl font-bold text-stone-100 truncate">Family Info</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 p-1.5 text-stone-400 hover:text-stone-100 rounded-md hover:bg-stone-800/60 transition"
            >
              <X size={18} />
            </button>
          </div>
          <p className="mt-1.5 text-xs md:text-sm text-stone-300 leading-snug">
            Phone, SSN, birthday, DL, passport, address — for everyone. Tap a row to open the full card.
          </p>
          {lastUpdatedLabel && (
            <p className="mt-1.5 text-[10px] uppercase tracking-[0.16em] text-stone-500">
              Updated <span className="text-stone-300 font-medium normal-case tracking-normal">{lastUpdatedLabel}</span>
            </p>
          )}
        </div>

        <ul className="divide-y divide-stone-700/40">
          {vitals.map((v) => (
            <VitalRow key={v.displayName} v={v} canEditOthers={canEditOthers} />
          ))}
        </ul>

        <div className="border-t border-stone-700/60">
          <div className="px-4 md:px-6 py-2.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSourcesOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-200 italic transition"
            >
              {sourcesOpen ? '▾' : '▸'} Where does each field come from?
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-stone-300 hover:text-stone-100 transition"
            >
              Close
            </button>
          </div>
          {sourcesOpen && (
            <div className="px-4 md:px-6 pb-4 text-[11px] text-stone-400 leading-relaxed space-y-1.5">
              <SourceLine field="Phone" source="users.phone" edit="Settings → Profile" />
              <SourceLine field="Email" source="users.email" edit="Auth — set when you signed in" />
              <SourceLine field="Birthday" source="users.dateOfBirth" edit="Settings → Profile" />
              <SourceLine field="SSN" source="users.ssn" edit="Settings → Profile" />
              <SourceLine field="DL #" source="users.driversLicense" edit="Settings → Profile" />
              <SourceLine field="DL exp" source="users.driversLicenseExpiry" edit="Settings → Profile" />
              <SourceLine field="Passport" source="users.passport" edit="Settings → Profile" />
              <SourceLine field="Car reg" source="asset entry · customFields.registrationExpiry" edit="Asset entry where Driver = this member (kind = Car / Truck / Boat / etc.)" />
              <SourceLine field="Anniv" source="users.anniversary" edit="Settings → Profile" />
              <SourceLine field="Address" source="users.address" edit="Settings → Profile" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function VitalRow({ v, canEditOthers }: { v: FamilyVital; canEditOthers: boolean }) {
  const bday = v.dateOfBirth ? formatDob(v.dateOfBirth) : null
  const dlExp = v.driversLicenseExpiry ? formatDob(v.driversLicenseExpiry) : null
  const anniv = v.anniversary ? formatDob(v.anniversary) : null
  const avatarUrl = v.userId
    ? `/api/avatars/${v.userId}${v.updatedAtMs ? `?v=${v.updatedAtMs}` : ''}`
    : null
  const initial = v.displayName.charAt(0).toUpperCase()
  const tone = personTone(v.displayName)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <li
      className="px-4 md:px-6 py-2 border-l-4 hover:brightness-110 transition"
      style={{ borderLeftColor: tone.borderColor, background: tone.bg }}
    >
      {/* Row header: name + role on the left, avatar + edit affordances on
          the right. Field grid below uses the full row width so fields can
          pack 2-up on phones and 3-up on desktop. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
          <p className="text-base md:text-lg font-semibold" style={{ color: tone.nameColor }}>{v.displayName}</p>
          <span className="text-[10px] uppercase tracking-[0.16em] text-stone-500">{v.role}</span>
          {v.userId == null && (
            <span className="text-[10px] uppercase tracking-[0.16em] text-amber-400/80 bg-amber-950/40 border border-amber-800/40 rounded-full px-1.5 py-0.5">
              Not joined yet
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <div className="h-9 w-9 rounded-full border border-stone-700/60 bg-stone-800 overflow-hidden flex items-center justify-center">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-semibold text-stone-400">{initial}</span>
            )}
          </div>
          {/* Edit profile (writes users.* — the fields rendered in this row).
              Owner-only: only Lance / superusers see this. Pre-join slots
              still show the button so Lance can see it's coming, but the
              modal explains there's no row to edit yet. */}
          {canEditOthers && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label={`Edit ${v.displayName}'s profile`}
              title="Edit profile fields"
              className="inline-flex items-center justify-center h-9 w-9 hover:brightness-125 border rounded-md transition"
              style={{ color: tone.pencilColor, background: tone.pencilBg, borderColor: tone.pencilBorderColor }}
            >
              <Pencil size={14} />
            </button>
          )}
          {/* Identity entry deep-link — separate concept from profile. Shows
              the IdCard icon when the entry exists, UserPlus when it doesn't.
              Kept as a small secondary affordance so the popout still bridges
              over to the vault entry's encrypted side. */}
          {v.identityEntryId ? (
            <Link
              href={`/entries/${v.identityEntryId}/edit`}
              aria-label={`Open ${v.displayName}'s card`}
              title="Open ID card entry"
              className="inline-flex items-center justify-center h-9 w-9 text-stone-300 hover:text-stone-100 bg-stone-800/60 hover:bg-stone-700 border border-stone-700/60 rounded-md transition"
            >
              <IdCard size={14} />
            </Link>
          ) : (
            <Link
              href={`/entries/new?type=identity${v.displayName ? `&firstName=${encodeURIComponent(v.displayName)}` : ''}`}
              aria-label={`Create ${v.displayName}'s card`}
              title="Create ID card entry"
              className="inline-flex items-center justify-center h-9 w-9 text-stone-300 hover:text-stone-100 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded-md transition"
            >
              <UserPlus size={14} />
            </Link>
          )}
        </div>
      </div>
      {editOpen && (
        <FamilyMemberEditModal
          vital={v}
          toneColor={tone.nameColor}
          onClose={() => setEditOpen(false)}
        />
      )}
      {/* Inline label-value fields — each cell is one line ("LABEL value")
          instead of a stacked label+value, so the popout reads as a
          compact card. 2-col on phones, 3-col from sm+. Address spans
          the full row width on its own line. */}
      <dl className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-[12px]">
        <InlineField label="Phone" value={v.phone ? formatPhone(v.phone) : null} copyText={v.phone} />
        <InlineField label="Email" value={v.email} />
        <InlineField label="Birthday" value={bday} />
        <InlineField label="SSN" value={v.ssn ? formatSsn(v.ssn) : null} mono copyText={v.ssn} />
        <InlineField label="DL" value={v.driversLicense} mono />
        <InlineField label="DL exp" value={dlExp} />
        <InlineField label="Passport" value={v.passport} mono />
        <InlineField label="Car reg" value={v.carRegExpiry ? formatDob(v.carRegExpiry) : null} />
        {v.isParent && <InlineField label="Anniv" value={anniv} />}
        <InlineField label="Address" value={v.address} spanFull />
      </dl>
    </li>
  )
}

// One row in the "Where does each field come from?" panel. Keeps the
// data-lineage map readable: field name on the left, db source in
// mono, where-to-edit on the right.
function SourceLine({ field, source, edit }: { field: string; source: string; edit: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr_auto] gap-x-3 items-baseline">
      <span className="text-[10px] uppercase tracking-[0.16em] text-stone-500 font-semibold">{field}</span>
      <span className="font-mono text-[10px] text-stone-400 truncate">{source}</span>
      <span className="text-[11px] text-stone-300 text-right">{edit}</span>
    </div>
  )
}

// Compact label+value inline pair — "PHONE 770.555.9358 [copy]" on a
// single line instead of label-over-value. Every populated field gets a
// copy affordance, including the address (it spans the row width and
// wraps, but the copy icon still tails the value).
function InlineField({
  label,
  value,
  copyText,
  mono,
  spanFull,
}: {
  label: string
  value: string | null
  copyText?: string | null
  mono?: boolean
  spanFull?: boolean
}) {
  const canCopy = !!value
  return (
    <div className={`min-w-0 flex ${spanFull ? 'items-start' : 'items-baseline'} gap-1.5 leading-tight ${spanFull ? 'col-span-2 sm:col-span-3' : ''}`}>
      <span className="text-[9px] uppercase tracking-[0.16em] text-stone-500 font-semibold shrink-0 mt-px">{label}</span>
      <span className={`min-w-0 flex-1 ${spanFull ? 'whitespace-normal break-words' : 'truncate'} ${value ? 'text-stone-200' : 'text-stone-600 italic'} ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value ?? 'not set'}
      </span>
      {canCopy && (
        <CopyIcon text={copyText ?? value ?? ''} label={`Copy ${label}`} />
      )}
    </div>
  )
}

// Tiny inline copy icon that sits at the end of each compact field
// value. Half-opaque by default per Lance's spec; full opacity on hover
// or for the 1.5s after a successful copy. Uses the same clipboard
// fallback path as CopyButton so it works on http://localhost during
// dev. Stops propagation so clicking it doesn't fire row hover effects.
function CopyIcon({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : label}
      aria-label={label}
      className={`shrink-0 p-0.5 rounded transition ${
        copied
          ? 'text-emerald-400 opacity-100'
          : 'text-stone-300 opacity-50 hover:opacity-100 hover:text-stone-100'
      }`}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  )
}

// "Updated last: 2026-06-18" — short, locale-formatted MM/DD/YYYY style
// that reads the same as the other dates in the modal.
function formatLastUpdated(d: Date | string | null): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Phone formatter — render the standard XXX.XXX.XXXX shape Lance has
// elsewhere in the app. Leaves anything weirdly long alone.
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1)
    return `1.${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  }
  return raw
}

// SSN formatter — render XXX-XX-XXXX. Leaves shorter strings as-is so a
// half-typed profile still shows something legible.
function formatSsn(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
  return raw
}

// DOB stored as YYYY-MM-DD — render as MM/DD/YYYY for at-a-glance read.
function formatDob(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[2]}/${m[3]}/${m[1]}`
  return raw
}
