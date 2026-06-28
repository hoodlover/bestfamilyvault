'use client'

import { useEffect, useState } from 'react'

interface Props {
  visible: boolean
  onClose: () => void
  src?: string
  /** Auto-close after this many ms. Default 5000. */
  durationMs?: number
  /**
   * If set, render the image at natural size × this multiplier (centered on
   * the backdrop) instead of filling the screen with object-contain. Useful
   * for small/grainy assets that would look stretched if blown up to full-screen.
   */
  naturalScale?: number
}

// Outer wrapper just unmounts the inner overlay when not visible. Fresh mount
// on each open means `fading` starts false naturally — no setState-in-effect.
export function FamilyPhotoOverlay({
  visible,
  onClose,
  src = '/icons/cobb/cfv-animals-logo-real-no-smile.png',
  durationMs = 5000,
  naturalScale,
}: Props) {
  if (!visible) return null
  return (
    <FamilyPhotoOverlayInner
      onClose={onClose}
      src={src}
      durationMs={durationMs}
      naturalScale={naturalScale}
    />
  )
}

interface InnerProps {
  onClose: () => void
  src: string
  durationMs: number
  naturalScale?: number
}

function FamilyPhotoOverlayInner({ onClose, src, durationMs, naturalScale }: InnerProps) {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setFading(true)
      setTimeout(onClose, 500)
    }, durationMs)
    return () => clearTimeout(t)
  }, [onClose, durationMs])

  function close() {
    setFading(true)
    setTimeout(onClose, 400)
  }

  return (
    <div
      onClick={close}
      className={`fixed inset-0 z-[150] cursor-pointer bg-black/85 flex items-center justify-center transition-opacity duration-500 ${fading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={naturalScale ? 'block max-w-[90vw] max-h-[90vh]' : 'w-full h-full object-contain'}
        style={naturalScale ? { transform: `scale(${naturalScale})`, transformOrigin: 'center' } : undefined}
      />
      <div className="absolute inset-x-0 bottom-12 flex justify-center pointer-events-none">
        <p className="text-white/60 text-xs tracking-widest uppercase">tap to close</p>
      </div>
    </div>
  )
}
