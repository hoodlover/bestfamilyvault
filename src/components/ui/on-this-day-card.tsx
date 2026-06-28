import Link from 'next/link'
import type { OnThisDayItem } from '@/lib/on-this-day'

interface Props {
  item: OnThisDayItem
}

// Tone now drives only the gradient wash + the kind-label text colour.
// The outer outline is the same neutral grey on every kind (and matches
// the Net Worth card) so the dashboard reads as a single calm stack.
const KIND_TONE = {
  letter: { bg: 'from-purple-950/40', label: 'text-purple-300/80' },
  note:   { bg: 'from-amber-950/30',  label: 'text-amber-400/70' },
  entry:  { bg: 'from-emerald-950/30', label: 'text-emerald-400/70' },
} as const

export function OnThisDayCard({ item }: Props) {
  const dateStr = new Date(item.createdAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const tone = KIND_TONE[item.kind]
  const kindLabel = item.flavor ?? item.kind

  return (
    <Link
      href={item.href}
      className={`group block rounded-2xl border border-stone-600/50 hover:border-stone-500/70 bg-gradient-to-br ${tone.bg} via-stone-900/50 to-stone-900/60 p-4 transition mb-6`}
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/cobb/icons/family/tvshows2-007.png"
          alt=""
          className="h-10 w-10 object-contain shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] uppercase tracking-[0.2em] font-semibold ${tone.label}`}>
            On this day · {item.yearsAgo} year{item.yearsAgo === 1 ? '' : 's'} ago · {kindLabel}
          </p>
          <p className="text-sm md:text-base font-semibold text-stone-100 mt-0.5 truncate group-hover:text-white transition">
            {item.title}
          </p>
          {item.preview && (
            <p className="mt-1 text-xs md:text-sm text-stone-400 line-clamp-2">{item.preview}</p>
          )}
          <p className="mt-2 text-[11px] text-stone-500">{dateStr}</p>
        </div>
      </div>
    </Link>
  )
}
