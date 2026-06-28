// Banner shown across the dashboard when DEMO_MODE is on. Tells visitors
// that the data resets periodically and warns them not to enter real
// credentials.

import { Sparkles } from 'lucide-react'

export function DemoBanner() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return null

  return (
    <div className="bg-amber-900/80 border-b border-amber-700 text-amber-100 text-xs px-4 py-2 flex items-center justify-center gap-2 sticky top-0 z-40 backdrop-blur">
      <Sparkles size={13} className="text-amber-300 shrink-0" />
      <span className="text-center">
        <span className="font-semibold">Demo mode</span> — sample data only, resets periodically.
        Don&apos;t enter real passwords.
      </span>
    </div>
  )
}
