'use client'

// Generic print trigger — window.print() pops the browser's print dialog,
// which on every desktop browser includes "Save as PDF" as a destination
// so we don't need a server-side PDF library. Pair with `.no-print` on
// any UI chrome you want hidden in the printed view, and an @media print
// block on the page itself for layout cleanup.

import { Printer } from 'lucide-react'

interface Props {
  label?: string
  /** Optional tailwind override; defaults to the stone-toned chip used on
   *  /admin/capabilities. */
  className?: string
}

export function PrintButton({ label = 'Print / Save as PDF', className }: Props) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={className ?? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-lg transition no-print'}
    >
      <Printer size={14} />
      {label}
    </button>
  )
}
