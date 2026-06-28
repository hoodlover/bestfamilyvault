'use client'

// Vehicular asset fields — VIN, license plate, driver, insurance #,
// registration expiry, mileage log. Rendered inside the Asset block when
// the kind matches Car / Truck / etc. (see isVehicularKind below).
//
// Values land in customFields on the entry (no schema change). The
// driver link is the key for the Family Info popout: matching by
// customFields.driverUserId is how we surface "Heather's car expires
// May 2027" under her row.
//
// Mileage history (v273) is stored as a JSON string under
// customFields.mileageHistory: `[{ date: "2026-06-18", miles: 87432 }, …]`.
// Multiple readings per year supported — Lance just adds one whenever
// he checks. Display sorts newest-first; storage order is preserved as
// entered.
//
// Shared between new-entry-form and edit-entry-form so the two stay in
// lockstep. Each consumer passes its own familyProfiles list + default
// values pulled from the entry's customFields.

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  isVehicularKind,
  parseMileageHistory,
  type MileageReading,
  type VehicularProfile,
} from '@/lib/vehicular'

// Re-export so existing call sites that import these from this file
// (edit-entry-form.tsx, new-entry-form.tsx) keep working without an
// import path change. Server components MUST import from @/lib/vehicular
// directly — going through this 'use client' file crashes server render
// with a numeric Next.js digest.
export { isVehicularKind, parseMileageHistory }
export type { MileageReading, VehicularProfile }

interface Props {
  familyProfiles: VehicularProfile[]
  defaults?: {
    vin?: string
    licensePlate?: string
    driverUserId?: string
    insuranceAccountNumber?: string
    registrationExpiry?: string
    /** Raw JSON string off customFields.mileageHistory. Optional — old
     *  entries that pre-date the field default to an empty list. */
    mileageHistory?: string
  }
}

export function VehicularFieldsBlock({ familyProfiles, defaults }: Props) {
  // Track driver locally so the select stays in sync after a defaults
  // refresh (e.g. the edit form remount). Not strictly necessary for
  // form submission since the underlying select handles it.
  const [driverUserId, setDriverUserId] = useState(defaults?.driverUserId ?? '')

  // Mileage log local state. Parsed once from the JSON default, then
  // mirrored into a hidden input so the existing extractCustomFields /
  // mergeCustomFields plumbing (which reads form fields by name) just
  // picks up `mileageHistory` as one more known key.
  const [readings, setReadings] = useState<MileageReading[]>(() =>
    parseMileageHistory(defaults?.mileageHistory)
  )
  const sortedForDisplay = useMemo(
    () => [...readings].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [readings]
  )
  // Today as YYYY-MM-DD — saves the user a tap when adding the latest
  // reading. Computed on the client so it follows the user's clock.
  const todayISO = new Date().toISOString().slice(0, 10)
  const [newDate, setNewDate] = useState(todayISO)
  const [newMiles, setNewMiles] = useState('')

  function addReading() {
    const miles = Number(newMiles.replace(/,/g, ''))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return
    if (!Number.isFinite(miles) || miles < 0) return
    setReadings((prev) => [...prev, { date: newDate, miles: Math.round(miles) }])
    setNewMiles('')
    // Don't reset the date — Lance might be backfilling several years in
    // a row and the calendar's already near where he wants it.
  }

  function removeReading(idx: number) {
    setReadings((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/15 p-3 space-y-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Vehicle details</p>
      <div className="grid grid-cols-2 gap-4">
        <SmallField label="VIN" name="vin" defaultValue={defaults?.vin} placeholder="17 chars" />
        <SmallField label="License Plate" name="licensePlate" defaultValue={defaults?.licensePlate} placeholder="ABC-1234" />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Driver</label>
        <select
          name="driverUserId"
          value={driverUserId}
          onChange={(e) => setDriverUserId(e.target.value)}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        >
          <option value="">No driver assigned</option>
          {familyProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <SmallField label="Insurance Acct #" name="insuranceAccountNumber" defaultValue={defaults?.insuranceAccountNumber} placeholder="USAA…" />
        <SmallField label="Registration Expires" name="registrationExpiry" defaultValue={defaults?.registrationExpiry} type="date" />
      </div>

      {/* Mileage log — add as many (date, miles) readings as the user
          wants. Hidden input mirrors the live list as JSON so the server
          action picks it up as customFields.mileageHistory without any
          new server plumbing beyond a known-key entry. */}
      <div className="border-t border-emerald-700/30 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Mileage log</p>
          <p className="text-[10px] text-stone-500">{readings.length} reading{readings.length === 1 ? '' : 's'}</p>
        </div>
        <input type="hidden" name="mileageHistory" value={JSON.stringify(readings)} />

        {sortedForDisplay.length > 0 && (
          <ul className="space-y-1.5">
            {sortedForDisplay.map((r) => {
              // Find the index in the original (unsorted) list so the
              // remove button targets the right entry.
              const origIdx = readings.findIndex(
                (x) => x.date === r.date && x.miles === r.miles,
              )
              return (
                <li
                  key={`${r.date}-${r.miles}`}
                  className="flex items-center gap-2 text-sm bg-stone-900/50 border border-stone-700/40 rounded-lg px-2.5 py-1.5"
                >
                  <span className="text-stone-300 tabular-nums shrink-0 w-24">{formatDateShort(r.date)}</span>
                  <span className="text-stone-100 tabular-nums font-medium flex-1">
                    {r.miles.toLocaleString()} mi
                  </span>
                  <button
                    type="button"
                    onClick={() => removeReading(origIdx)}
                    aria-label="Remove reading"
                    className="text-stone-500 hover:text-red-400 transition p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-[0.16em] text-stone-500 mb-0.5">Date</label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-[0.16em] text-stone-500 mb-0.5">Miles</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="87,432"
              value={newMiles}
              onChange={(e) => setNewMiles(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addReading()
                }
              }}
              className="w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>
          <button
            type="button"
            onClick={addReading}
            disabled={!newMiles.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-700 disabled:text-stone-500 text-white text-sm font-medium rounded-lg transition shrink-0"
          >
            <Plus size={13} />
            Add
          </button>
        </div>
      </div>

      <p className="text-[10px] text-stone-500 leading-relaxed">
        Set the driver to link this vehicle to a family member — their Family Info popout will surface the registration expiry under their row.
      </p>
    </div>
  )
}

// Render YYYY-MM-DD as "Jun 18, 2026" so the readings list scans easily.
function formatDateShort(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Lightweight local field — kept here so VehicularFieldsBlock is fully
// self-contained and doesn't depend on the bigger form helpers.
function SmallField({
  label,
  name,
  defaultValue,
  placeholder,
  type = 'text',
}: {
  label: string
  name: string
  defaultValue?: string
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-300 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
      />
    </div>
  )
}
