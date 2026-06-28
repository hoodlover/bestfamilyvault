'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

// Prominent "Back" button at the top of an entry detail page.
//
// Why this exists: the only navigation back was a faint 20%-opaque
// breadcrumb at the bottom of the breadcrumb row — easy to miss,
// especially on mobile. This is the actionable, visible alternative.
//
// router.back() walks the browser history, so it lands wherever the
// user actually came from: search results (with the query restored,
// per the v1.9.0 back-button-search-restore fix), category page,
// dashboard favorites, etc. Falls back to /dashboard if there's no
// prior history entry (rare — direct link, email, opened in new tab).
export function EntryBackButton() {
  const router = useRouter()

  function handleClick() {
    // history.length > 1 means there's something to go back to.
    // length === 1 means this is the only entry — we opened in a fresh
    // tab/window. Send to dashboard in that case so the button never
    // does nothing.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-3 text-sm font-medium text-stone-300 bg-stone-800 hover:bg-stone-700 border border-stone-700 hover:border-stone-600 rounded-lg transition"
      aria-label="Go back"
    >
      <ChevronLeft size={15} />
      Back
    </button>
  )
}
