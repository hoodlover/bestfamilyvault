// Pure helpers for vehicular asset entries — kind classification, mileage
// history parsing, shared types. Lives in lib/ (not in the client component
// file) so server components can import them too.
//
// Reason this module exists: vehicular-fields-block.tsx is `'use client'`,
// and importing a non-component helper from a client module into a server
// component crashes at render with a numeric Next.js digest. Keeping the
// helpers here keeps the boundary clean.

const VEHICULAR_KEYWORDS = [
  'car',
  'truck',
  'vehicle',
  'boat',
  'motorcycle',
  'rv',
  'atv',
  'trailer',
  'suv',
  'van',
  'auto',
]

/** True when an asset entry's accountType reads as a vehicle of some
 *  kind (Car / Truck / Boat / etc.). Drives the VehicularFieldsBlock
 *  render gate in both create + edit forms and the Mileage panel on
 *  the asset detail page. */
export function isVehicularKind(kind: string | null | undefined): boolean {
  const k = (kind ?? '').trim().toLowerCase()
  if (!k) return false
  return VEHICULAR_KEYWORDS.some((v) => k === v || k.includes(v))
}

/** Family-member profile shape consumed by the driver dropdown. Lives
 *  here so server callers can construct typed defaults without pulling
 *  in the client component. */
export interface VehicularProfile {
  id: string
  name: string
}

/** A single mileage reading. `date` is YYYY-MM-DD; `miles` is a whole
 *  number of miles (no decimals, no thousand-separators). */
export interface MileageReading {
  date: string
  miles: number
}

/** Parse the JSON-encoded mileageHistory string off customFields. Returns
 *  an empty array on bad/missing input. Defensive — never throws — so
 *  both client and server consumers can call without try/catch. */
export function parseMileageHistory(raw: string | null | undefined): MileageReading[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: MileageReading[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const date = typeof item.date === 'string' ? item.date.trim() : ''
      const miles = Number(item.miles)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (!Number.isFinite(miles) || miles < 0) continue
      out.push({ date, miles: Math.round(miles) })
    }
    return out
  } catch {
    return []
  }
}
