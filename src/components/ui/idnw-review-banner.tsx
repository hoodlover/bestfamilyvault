import Link from 'next/link'
import { ClipboardList } from 'lucide-react'

// Dashboard nudge that surfaces stale IDNW topics — yearly-review-flagged
// notes whose underlying row hasn't been touched in > 12 months. Renders
// nothing when count is 0 so the dashboard stays calm by default.
//
// Visual tone: warm amber (it's a reminder, not an emergency) and quiet
// enough to live above the action tiles without stealing focus from
// regular dashboard widgets. Tap → /now-what so Lance can scan the
// "Review due" pills on the topic cards.

interface Props {
  count: number
}

export function IdnwReviewBanner({ count }: Props) {
  if (count <= 0) return null
  const noun = count === 1 ? 'answer' : 'answers'

  return (
    <Link
      href="/now-what"
      className="group block mb-5 rounded-2xl border border-amber-800/40 bg-gradient-to-br from-amber-950/30 to-stone-900/40 px-4 py-3 transition hover:border-amber-600/60 hover:from-amber-950/40"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-amber-600/15 border border-amber-700/40 shrink-0">
          <ClipboardList size={18} className="text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-amber-100">
            {count} {noun} in the death vault need a yearly review
          </div>
          <div className="text-xs text-amber-200/70 mt-0.5">
            Tax, insurance, and account answers go stale every year — tap to see what&rsquo;s overdue.
          </div>
        </div>
        <span className="text-xs font-mono text-amber-300/80 shrink-0 group-hover:text-amber-200 transition">→</span>
      </div>
    </Link>
  )
}
