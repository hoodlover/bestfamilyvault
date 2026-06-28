// Dashboard banner that surfaces pending recurring-charge suggestions
// from the weekly detector. Single-line, link straight to the Suggested
// tab so Lance can approve/dismiss in one tap from the home screen.
// Hidden when there's nothing pending — no noise when the queue is
// empty.

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { and, eq, count } from 'drizzle-orm'
import { db } from '@/lib/db'
import { recurringSuggestions } from '@/lib/db/schema'

export async function RecurringSuggestionBanner({ userId }: { userId: string }) {
  const [row] = await db
    .select({ value: count() })
    .from(recurringSuggestions)
    .where(
      and(
        eq(recurringSuggestions.userId, userId),
        eq(recurringSuggestions.status, 'pending'),
      ),
    )

  const pending = row?.value ?? 0
  if (pending === 0) return null

  return (
    <Link
      href="/subscriptions?tab=suggested"
      className="mb-5 flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/30 transition"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles size={14} className="text-emerald-400 shrink-0" />
        <span className="text-sm">
          {pending === 1
            ? '1 recurring charge detected — review it'
            : `${pending} recurring charges detected — review them`}
        </span>
      </div>
      <span className="text-xs text-emerald-400 shrink-0">→</span>
    </Link>
  )
}
