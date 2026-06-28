'use client'

// Full-screen cooking mode. Hands-busy in the kitchen — big text on a
// black background, prev/next at the bottom in chunky tap targets, a
// speaker button per step that reads the step aloud, and a wake lock
// so the phone doesn't dim mid-recipe.
//
// Steps come from /api/recipe-cook-split (Claude Haiku, ~$0.001/recipe).
// The result is cached in localStorage keyed by note id + content hash
// so we don't pay for re-splits on every cook. Cache invalidates
// automatically when the recipe content changes.
//
// Owns the viewport via fixed inset-0 z-[9999] — sits above the
// dashboard chrome, the floating buttons, and the bottom nav.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Volume2, VolumeX, X } from 'lucide-react'

interface CookStep {
  text: string
  ingredients: string[]
}

interface Props {
  noteId: string
  title: string
  /**
   * A short stable hash of the recipe content. Used as part of the
   * localStorage cache key so editing the recipe invalidates the
   * cached steps automatically.
   */
  contentHash: string
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
  released: boolean
}

const CACHE_KEY = (noteId: string, hash: string) => `bestfamilyvault:cook-steps:${noteId}:${hash}`
// Cap stored caches at a reasonable size so users don't run into
// localStorage quotas after dozens of recipes. We only need a small
// number — recent ones — and the API regenerates fresh on miss.
const MAX_CACHED_RECIPES = 30

function readCache(noteId: string, hash: string): CookStep[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY(noteId, hash))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { steps?: CookStep[] } | CookStep[]
    const steps = Array.isArray(parsed) ? parsed : parsed.steps
    return Array.isArray(steps) && steps.length > 0 ? steps : null
  } catch {
    return null
  }
}

function writeCache(noteId: string, hash: string, steps: CookStep[]) {
  if (typeof window === 'undefined') return
  try {
    // Trim oldest cook-step caches if we're at the cap.
    const allKeys = Object.keys(window.localStorage).filter((k) => k.startsWith('bestfamilyvault:cook-steps:'))
    if (allKeys.length >= MAX_CACHED_RECIPES) {
      // FIFO eviction: drop the first key alphabetically (good enough — these are not time-stamped).
      allKeys.sort()
      for (let i = 0; i < allKeys.length - MAX_CACHED_RECIPES + 1; i++) {
        window.localStorage.removeItem(allKeys[i])
      }
    }
    window.localStorage.setItem(CACHE_KEY(noteId, hash), JSON.stringify({ steps }))
  } catch {
    // Quota exceeded or storage disabled — quietly drop.
  }
}

export function RecipeCookMode({ noteId, title, contentHash }: Props) {
  const router = useRouter()
  const [steps, setSteps] = useState<CookStep[] | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

  // Load steps: cache hit → instant; miss → API call.
  useEffect(() => {
    const cached = readCache(noteId, contentHash)
    if (cached) {
      setSteps(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/recipe-cook-split', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteId }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !Array.isArray(data.steps)) {
          setError(data.error ?? 'Could not split this recipe into steps.')
          setLoading(false)
          return
        }
        const fresh = data.steps as CookStep[]
        writeCache(noteId, contentHash, fresh)
        setSteps(fresh)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Step-splitter failed.')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [noteId, contentHash])

  // Wake lock so the phone screen doesn't dim during cooking. Some
  // browsers (older iOS, anything sans the API) silently no-op.
  // Re-requests on visibility change because OSes drop the lock when
  // the tab is hidden.
  useEffect(() => {
    let active = true

    async function request() {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }
        if (!nav.wakeLock) return
        const lock = await nav.wakeLock.request('screen')
        if (!active) {
          await lock.release().catch(() => {})
          return
        }
        wakeLockRef.current = lock
      } catch {
        // User denied, or the device already lost the lock — ignore.
      }
    }

    request()

    function onVisible() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current?.released) request()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  // Stop speaking on unmount or when navigating between steps. iOS
  // queues utterances forever if you don't cancel.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [stepIdx])

  const exit = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    router.push(`/notes/${noteId}`)
  }, [router, noteId])

  // Keyboard arrows for desktop. Disabled when speaking so an Enter
  // press while the speech is ongoing doesn't accidentally jump.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!steps) return
      if (e.key === 'ArrowRight') setStepIdx((i) => Math.min(steps.length - 1, i + 1))
      else if (e.key === 'ArrowLeft') setStepIdx((i) => Math.max(0, i - 1))
      else if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps, exit])

  function speakCurrent() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (!steps) return
    const cur = steps[stepIdx]
    if (!cur) return
    window.speechSynthesis.cancel()
    // Build a spoken line that's friendlier than the raw text.
    // Prepend "Step N of M" so the cook can confirm they heard the
    // right one when their hands are messy.
    const intro = `Step ${stepIdx + 1} of ${steps.length}.`
    const ingredientsLine = cur.ingredients.length > 0
      ? ` Using: ${cur.ingredients.join(', ')}.`
      : ''
    const u = new SpeechSynthesisUtterance(`${intro} ${cur.text}${ingredientsLine}`)
    u.rate = 0.95
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }

  function stopSpeaking() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Last-step Next becomes "Done" + closes — spec calls for the bottom
  // button to commit the cook, not just bottom-out the step counter.
  const isLastStep = !!steps && stepIdx === steps.length - 1
  const onNextOrDone = () => {
    if (isLastStep) {
      exit()
      return
    }
    if (steps) setStepIdx((i) => Math.min(steps.length - 1, i + 1))
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col text-stone-100"
      style={{ background: '#050505' }}
    >
      {/* Top bar: recipe title rendered AS the kicker (caps + wide-tracked),
          paired with a 44px round close. Step body owns the rest. */}
      <header className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top,12px),12px)] pb-2">
        <div className="min-w-0 flex-1 cv-kicker truncate">
          {title}
        </div>
        <button
          type="button"
          onClick={exit}
          aria-label="Exit cooking mode"
          className="shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-full border border-stone-700 bg-stone-900 hover:bg-stone-800 active:scale-95 transition"
        >
          <X size={18} />
        </button>
      </header>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-sm text-stone-400">
              Splitting the recipe into steps…
            </p>
            <p className="mt-1 text-xs text-stone-600">
              (Only happens the first time you cook this one.)
            </p>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-amber-300 mb-3">{error}</p>
            <Link
              href={`/notes/${noteId}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded-lg transition"
            >
              <ChevronLeft size={14} />
              Back to recipe
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && steps && steps[stepIdx] && (
        <>
          {/* Step body — centered. Step counter (mono accent), then the
              step text at the spec's 27px/600 line-height-snug, the step's
              ingredients as pill chips, and a "Read aloud" outline pill. */}
          <div className="flex-1 overflow-y-auto px-5 md:px-10 flex flex-col justify-center gap-5">
            <div className="font-mono text-xs tracking-[0.14em] uppercase text-accent-300">
              Step {stepIdx + 1} of {steps.length}
            </div>

            <p className="text-[27px] md:text-4xl font-semibold leading-snug text-stone-50">
              {steps[stepIdx].text}
            </p>

            {steps[stepIdx].ingredients.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {steps[stepIdx].ingredients.map((ing, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/[0.05] border border-stone-700/40 text-xs text-stone-200"
                  >
                    {ing}
                  </span>
                ))}
              </div>
            )}

            {ttsSupported && (
              <button
                type="button"
                onClick={() => (speaking ? stopSpeaking() : speakCurrent())}
                aria-label={speaking ? 'Stop reading' : 'Read step aloud'}
                title={speaking ? 'Stop reading' : 'Read step aloud'}
                className={`self-start inline-flex items-center gap-2 px-4 min-h-11 rounded-full border text-xs font-semibold transition active:scale-95 ${
                  speaking
                    ? 'border-accent-500/60 text-accent-300 bg-accent-500/10'
                    : 'border-stone-700 text-stone-400 hover:text-stone-200'
                }`}
              >
                {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                Read aloud
              </button>
            )}
          </div>

          {/* Step dots — kept from the previous design; useful jump UI
              for the cook glancing at progress mid-recipe. Not in spec
              but doesn't fight it. */}
          <div className="px-4 py-3 flex items-center justify-center gap-1.5 flex-wrap">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStepIdx(i)}
                aria-label={`Jump to step ${i + 1}`}
                className={`h-2 rounded-full transition ${i === stepIdx ? 'w-8 bg-accent-500' : 'w-2 bg-stone-700 hover:bg-stone-600'}`}
              />
            ))}
          </div>

          {/* Back / Next (or Done on the last step). 58px tall per spec —
              chunky tap targets for kitchen hands. */}
          <div
            className="flex gap-3 px-4 pt-2"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 16px)' }}
          >
            <button
              type="button"
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              disabled={stepIdx === 0}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-[58px] rounded-2xl border border-stone-700 bg-stone-900 text-stone-200 font-semibold text-base disabled:opacity-30 active:scale-[0.98] transition"
            >
              <ChevronLeft size={20} />
              Back
            </button>
            <button
              type="button"
              onClick={onNextOrDone}
              className="flex-[1.5] inline-flex items-center justify-center gap-1.5 h-[58px] rounded-2xl bg-accent-600 hover:bg-accent-500 text-white font-semibold text-base active:scale-[0.98] transition"
            >
              {isLastStep ? 'Done' : 'Next'}
              {!isLastStep && <ChevronRight size={20} />}
            </button>
          </div>

          <p
            className="text-center text-[10.5px] text-stone-500 px-4 pb-2"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 6px), 6px)' }}
          >
            Screen stays awake while you cook.
          </p>
        </>
      )}
    </div>
  )
}
