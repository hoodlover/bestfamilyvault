'use client'

// Per-page "what can I do here?" cheat-sheet. Click the ? button in
// the page header, modal opens with a short list of the features
// available on THIS page, grouped into sections. Designed for fast
// reading — leads with the feature name, one-line description after.
//
// Used like:
//   <HelpPopout
//     title="Meal plan"
//     sections={[
//       { heading: 'Recipes',  tips: [{ title: 'Pick recipes', description: 'Tick the box…' }] },
//       { heading: 'Shopping', tips: [...] },
//     ]}
//   />

import { useEffect, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'

export interface HelpTip {
  title: string
  description: string
}
export interface HelpSection {
  heading: string
  tips: HelpTip[]
}

export function HelpPopout({
  title,
  sections,
  label = '?',
}: {
  title: string
  sections: HelpSection[]
  /** Optional button label for desktop. On mobile only the icon shows. */
  label?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    // Lock body scroll while the modal's open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Tips: ${title}`}
        aria-label={`Tips for ${title}`}
        className="inline-flex items-center justify-center gap-1.5 h-8 px-2 rounded-full border border-stone-700 bg-stone-800 hover:bg-stone-700 hover:border-emerald-700/60 text-stone-300 hover:text-emerald-300 text-xs transition shrink-0"
      >
        <HelpCircle size={14} />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-stone-900 border border-emerald-700/50 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 20px), 20px)' }}
          >
            {/* Mobile drag handle */}
            <div className="sm:hidden mx-auto w-10 h-1 rounded-full bg-stone-700 -mt-2 mb-3" />
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-emerald-400 mb-0.5">Tips</p>
                <h2 className="text-lg font-bold text-stone-100">{title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close tips"
                className="p-1.5 text-stone-500 hover:text-stone-200 transition rounded-md hover:bg-stone-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5">
              {sections.map((sec) => (
                <section key={sec.heading}>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300 mb-2">
                    {sec.heading}
                  </h3>
                  <ul className="space-y-2">
                    {sec.tips.map((tip) => (
                      <li key={tip.title} className="text-sm leading-snug">
                        <span className="font-semibold text-stone-100">{tip.title}</span>
                        <span className="text-stone-400"> — {tip.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
