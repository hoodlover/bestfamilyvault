'use client'

// "Print / Save as PDF" trigger. window.print() opens the browser's
// print dialog, which on every desktop browser includes a "Save as
// PDF" destination — no server-side PDF library needed. The page's
// @media print rules (in the page below) clean up the UI for the
// printed view.

import { Printer } from 'lucide-react'

export function CapabilitiesPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-lg transition no-print"
    >
      <Printer size={14} />
      Print / Save as PDF
    </button>
  )
}
