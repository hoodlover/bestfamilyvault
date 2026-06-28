'use client'

// Round-swatch theme picker. Each swatch shows the theme's brightest
// representative shade (~accent-500/600) so what-you-see-is-what-you-get
// across the rest of the app. Clicking commits via updateThemeAccent
// and then triggers router.refresh() so the html data-theme attr swaps
// without a full reload.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { updateThemeAccent } from '@/lib/actions/settings'

interface ThemeOption {
  id: 'forest' | 'crimson' | 'midnight' | 'harvest'
  label: string
  /** Bright primary swatch — what the user will see on buttons + focus rings. */
  swatch: string
  /** One-line description shown under the active selection. */
  blurb: string
}

const THEMES: ThemeOption[] = [
  { id: 'forest',   label: 'Forest',   swatch: '#5E9A37', blurb: 'Default — closest cousin to the original emerald.' },
  { id: 'crimson',  label: 'Crimson',  swatch: '#C42626', blurb: 'Deep red. Vault-leather energy.' },
  { id: 'midnight', label: 'Midnight', swatch: '#2563EB', blurb: 'True blue. Low-key, easy on the eyes.' },
  { id: 'harvest',  label: 'Harvest',  swatch: '#E89A1A', blurb: 'Gold. The brightest of the four.' },
]

interface Props {
  currentTheme: string
}

export function ThemePicker({ currentTheme }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState(currentTheme)
  const [error, setError] = useState<string | null>(null)

  function pick(id: ThemeOption['id']) {
    if (id === selected || isPending) return
    setError(null)
    // Optimistic: paint the new swatch as selected immediately. The
    // <html data-theme> attribute won't change until the next render
    // (after router.refresh re-runs the root layout), so the rest of the
    // page is in transitional limbo for the ~200ms in between. Worth
    // the snappy UI on the swatch ring.
    setSelected(id)
    startTransition(async () => {
      const res = await updateThemeAccent(id)
      if (res?.error) {
        setError(res.error)
        setSelected(currentTheme)
        return
      }
      router.refresh()
    })
  }

  const activeBlurb = THEMES.find((t) => t.id === selected)?.blurb ?? ''

  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-4 md:p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-stone-100">Theme accent</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          Pick the color used for buttons, focus rings, and highlights. Only affects your account.
        </p>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        {THEMES.map((t) => {
          const isActive = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              disabled={isPending && !isActive}
              aria-label={`Switch theme to ${t.label}`}
              aria-pressed={isActive}
              title={t.label}
              className={clsx(
                // Spec calls for 50px dots with a double-ring active state.
                // The double ring is built from two box-shadows so it lands
                // independent of Tailwind's `ring-offset` colors (which fight
                // the gradient page bg). Outer ring matches the stone page,
                // creating a clean break between the two stone-100 rings.
                'group relative h-[50px] w-[50px] rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 focus-visible:ring-stone-300 disabled:opacity-60',
                isActive
                  ? 'shadow-[0_0_0_2px_var(--background),0_0_0_4px_rgb(245_245_244)]'
                  : 'hover:scale-105',
              )}
              style={{ backgroundColor: t.swatch }}
            >
              {isActive && (
                <span className="absolute inset-0 flex items-center justify-center">
                  {isPending ? (
                    <Loader2 size={16} className="animate-spin text-white drop-shadow" />
                  ) : (
                    <Check size={16} className="text-white drop-shadow" strokeWidth={3} />
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-stone-400">{activeBlurb}</p>

      {error && (
        <p className="mt-2 text-xs text-red-300 bg-red-950/30 border border-red-900/50 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}
    </section>
  )
}
