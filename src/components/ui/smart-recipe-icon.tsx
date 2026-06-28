'use client'

// Lazy image-picker for a recipe row, with a three-stage fallback chain:
//
//   1. Real food photo from Pexels (POST /api/recipe-pick-photo)
//      — most "recipe-card"-like result. Requires PEXELS_API_KEY.
//   2. Claude-Haiku-picked illustrated PNG from the existing icon set
//      (POST /api/recipe-pick-icon) — on-brand fallback.
//   3. Keyword-matched PNG (recipeIconFor) — purely local, no network.
//
// On mount the keyword fallback renders instantly so the row never sits
// blank. The lazy fetch tries Pexels first; if that 404s (no API key,
// no match) or errors, it falls through to the Claude icon, then to
// the keyword default. Whatever the final pick is gets cached in
// localStorage so we only pay for the lookup once per (title,tags) per
// device.
//
// Drop-in replacement for the static <img src={recipeIconFor(...)} />
// on the recipes list. Keeps the same width / height / className contract.

import { useEffect, useRef, useState } from 'react'
import { recipeIconFor } from '@/lib/recipe-icon-for'

interface Props {
  title: string
  tags?: string[] | null
  width?: number
  height?: number
  className?: string
  style?: React.CSSProperties
  alt?: string
}

// Prefix bumped to v2 when photo fallback was added so existing devices
// that already cached an illustrated icon at the v1 key re-resolve on
// their next mount and pick up the new Pexels photo (or fall through
// to the same icon if PEXELS_API_KEY isn't configured yet).
const STORAGE_PREFIX = 'cobbvault:recipe-image-v2:'
// Legacy entries get evicted lazily during cacheKey() lookups below so
// the user's localStorage doesn't grow forever.
const LEGACY_PREFIXES = ['cobbvault:recipe-icon:']

function cacheKey(title: string, tags: string[]): string {
  // Cheap stable key — title + sorted tags joined with a separator the
  // recipe author is very unlikely to type into either field.
  const normTags = [...tags].map((t) => t.toLowerCase()).sort().join(',')
  return `${STORAGE_PREFIX}${title.toLowerCase().trim()}|${normTags}`
}

/** Best-effort eviction of legacy cache entries for the same logical
 *  (title, tags) so an old v1 illustrated-icon pick doesn't stick
 *  around forever on devices that never got the v2 photo upgrade
 *  before localStorage filled up. */
function evictLegacy(title: string, tags: string[]) {
  if (typeof window === 'undefined') return
  const normTags = [...tags].map((t) => t.toLowerCase()).sort().join(',')
  const suffix = `${title.toLowerCase().trim()}|${normTags}`
  try {
    for (const prefix of LEGACY_PREFIXES) {
      window.localStorage.removeItem(`${prefix}${suffix}`)
    }
  } catch {
    // Quota / disabled — fine, nothing to do.
  }
}

/** True when the cached value is one of the local illustrated PNG
 *  paths instead of an upstream Pexels URL. Used to decide whether to
 *  bother trying the photo upgrade in the background. */
function isLocalIcon(value: string): boolean {
  return value.startsWith('/')
}

function readCache(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeCache(key: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode or full quota — silently ignore.
  }
}

export function SmartRecipeIcon({
  title,
  tags,
  width = 44,
  height = 44,
  className,
  style,
  alt = '',
}: Props) {
  const tagList = tags ?? []
  const [src, setSrc] = useState<string>(() => {
    const key = cacheKey(title, tagList)
    return readCache(key) ?? recipeIconFor(title, tagList)
  })
  const requestedRef = useRef(false)

  useEffect(() => {
    // Only fire the inference once per mount. The strict-mode double
    // render in dev guards itself via this ref so we don't double-spend.
    if (requestedRef.current) return
    requestedRef.current = true

    const key = cacheKey(title, tagList)
    const cached = readCache(key)
    // Sweep the v1 illustrated-icon key so it doesn't linger forever.
    evictLegacy(title, tagList)
    // Cache HIT but the stored value is still a local illustrated PNG?
    // Try to upgrade it to a real Pexels photo this mount. The fetch
    // still respects the same gracious fallback chain — no key / no
    // match / network error → we keep the cached icon untouched.
    if (cached && !isLocalIcon(cached)) {
      // External URL (Pexels) already cached — nothing to do.
      return
    }

    let cancelled = false
    ;(async () => {
      // Stage 1: real food photo (Pexels).
      try {
        const photoRes = await fetch('/api/recipe-pick-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, tags: tagList }),
        })
        if (photoRes.ok) {
          const data = (await photoRes.json().catch(() => null)) as { photoUrl?: string } | null
          if (data?.photoUrl) {
            writeCache(key, data.photoUrl)
            if (!cancelled) setSrc(data.photoUrl)
            return
          }
        }
        // 404 (no key / no match) and 502 (Pexels error) both fall through.
      } catch {
        // Network error — fall through.
      }

      if (cancelled) return

      // Stage 2: Claude picks an illustrated PNG from our icon set.
      try {
        const iconRes = await fetch('/api/recipe-pick-icon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, tags: tagList }),
        })
        if (!iconRes.ok) return
        const data = (await iconRes.json().catch(() => null)) as { iconPath?: string } | null
        if (!data?.iconPath) return
        writeCache(key, data.iconPath)
        if (!cancelled) setSrc(data.iconPath)
      } catch {
        // Stage 3 (keyword fallback) is already rendered via the
        // lazy-initialised useState, so nothing else to do.
      }
    })()
    return () => { cancelled = true }
    // Intentionally empty deps — we only run the inference once per
    // mount for the title+tags pair the row was created with. New rows
    // will pick up new icons on their own mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
    />
  )
}
