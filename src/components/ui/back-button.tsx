'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Props {
  /** Where to go if there's no history to pop back to. */
  fallback?: string
  /** Override label; defaults to "Back". */
  label?: string
  className?: string
  /** Optional width in px to override responsive sizing. Aspect ratio preserved.
   *  When omitted: 64px on mobile, 85px on md+. */
  size?: number
}

/**
 * Small back button using /icons/cobb/back.png. Tries history.back() first
 * (so users return to where they came from — e.g., a search result list)
 * and falls back to the provided route on cold loads.
 */
export function BackButton({ fallback = '/dashboard', label = 'Back', className = '', size }: Props) {
  const router = useRouter()

  function go() {
    // If we have history within the app, go back; otherwise navigate to fallback.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }

  // When `size` is given, lock to that pixel width via inline style (legacy
  // callers, or any spot that needs a specific size). Otherwise use a Tailwind
  // responsive width: 64px on mobile (~25% smaller than desktop) and 85px on
  // md+ desktop. Keep height auto so aspect ratio stays correct.
  const useResponsive = size === undefined

  return (
    <Link
      href={fallback}
      onClick={(e) => {
        e.preventDefault()
        go()
      }}
      aria-label={label}
      title={label}
      className={`inline-block transition hover:opacity-90 active:opacity-80 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/cobb/back.png"
        alt={label}
        style={useResponsive ? { height: 'auto' } : { width: size, height: 'auto' }}
        className={`block object-contain shrink-0 h-auto ${useResponsive ? 'w-[64px] md:w-[85px]' : ''}`}
      />
    </Link>
  )
}
