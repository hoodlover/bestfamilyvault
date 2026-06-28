'use client'

// Reusable in-page camera viewfinder. We use getUserMedia with
// facingMode: 'environment' instead of the native <input capture="environment">
// because iOS Safari treats that attribute as "open the camera app in
// whatever mode it was last used" — meaning the back-camera intent gets
// silently discarded once a user has snapped a selfie. Driving the stream
// directly forces the back camera reliably.
//
// Returns the captured frame as a JPEG File via onCapture.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw, X, Zap } from 'lucide-react'

interface Props {
  onCapture: (file: File) => void
  onClose: () => void
  /** Filename used when constructing the captured File. Defaults to "photo-<ts>.jpg". */
  fileName?: string
  /** JPEG quality 0–1. Default 0.92. */
  quality?: number
}

export function CameraCapture({ onCapture, onClose, fileName, quality = 0.92 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [ready, setReady] = useState(false)

  const startStream = useCallback(async (mode: 'environment' | 'user') => {
    setError(null)
    setReady(false)
    // Stop any previous stream before requesting a new one — switching cameras
    // otherwise leaves the old track running and some devices reject the
    // second getUserMedia call.
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop()
      streamRef.current = null
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // The video tag fires onLoadedMetadata once dimensions are known; that
        // unblocks the capture button. autoplay+playsInline is set on the
        // element so iOS doesn't black-bar it.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Camera permission denied or no camera found.'
      setError(message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (cancelled) return
      await startStream(facingMode)
    })()
    return () => {
      cancelled = true
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [facingMode, startStream])

  function flipCamera() {
    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
  }

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const name = fileName ?? `photo-${Date.now()}.jpg`
        const file = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
        onCapture(file)
      },
      'image/jpeg',
      quality,
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-black/80">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full text-stone-200 hover:bg-stone-800 transition"
          aria-label="Close camera"
        >
          <X size={22} />
        </button>
        <span className="text-xs uppercase tracking-[0.2em] text-stone-400">
          {facingMode === 'environment' ? 'Back camera' : 'Front camera'}
        </span>
        <button
          type="button"
          onClick={flipCamera}
          className="p-2 rounded-full text-stone-200 hover:bg-stone-800 transition"
          aria-label="Flip camera"
          title="Flip camera"
        >
          <RotateCcw size={20} />
        </button>
      </div>

      {/* Viewfinder */}
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black">
        {error ? (
          <div className="max-w-md text-center px-6">
            <Zap size={32} className="mx-auto mb-3 text-amber-400" />
            <p className="text-stone-200 font-medium">Camera unavailable</p>
            <p className="mt-1 text-sm text-stone-400">{error}</p>
            <p className="mt-3 text-xs text-stone-500">
              Check your browser&rsquo;s site settings and grant camera access, then reopen this page.
            </p>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => setReady(true)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      {/* Shutter */}
      <div className="flex items-center justify-center px-6 py-6 bg-black/80">
        <button
          type="button"
          onClick={capture}
          disabled={!ready || !!error}
          aria-label="Take photo"
          className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/0 active:bg-white/20 disabled:opacity-40 disabled:border-stone-600 transition"
        >
          <span className="h-12 w-12 rounded-full bg-white" />
        </button>
      </div>

      {/* Hint when not yet ready */}
      {!ready && !error && (
        <span className="absolute bottom-28 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.25em] text-stone-500">
          Starting camera…
        </span>
      )}

      {/* Hint icon imports — keeping Camera around so the bundle exposes it
          for future call sites without a fresh import diff. */}
      <Camera size={0} aria-hidden className="hidden" />
    </div>
  )
}
