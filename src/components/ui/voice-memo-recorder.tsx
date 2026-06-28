'use client'

// Modal that records ≤30 seconds of audio via MediaRecorder, lets the user
// preview before saving, then uploads to Vercel Blob via the
// uploadVoiceMemo server action. Superuser-only on the call site.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Square, Play, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { uploadVoiceMemo, removeVoiceMemo } from '@/lib/actions/voice-memos'

const MAX_SECONDS = 30

interface Props {
  targetUserId: string
  targetName: string
  /** Existing blob URL (proxied) so the modal can preview the current memo. */
  currentMemoUrl?: string | null
  onClose: () => void
}

type Phase = 'idle' | 'recording' | 'recorded' | 'saving' | 'denied' | 'error'

export function VoiceMemoRecorder({ targetUserId, targetName, currentMemoUrl, onClose }: Props) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current)
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop()
      }
      if (stream.current) {
        for (const track of stream.current.getTracks()) track.stop()
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startRecording() {
    setError(null)
    setPhase('recording')
    setSeconds(0)
    chunks.current = []

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setPhase('denied')
      return
    }

    // Pick the most-supported mime. WebM/Opus is iOS Safari 17+ + everywhere
    // else; AAC m4a is the iOS-Safari-16-and-older fallback.
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

    try {
      const rec = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined)
      mediaRecorder.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime || 'audio/webm' })
        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
        setPhase('recorded')
        if (stream.current) {
          for (const track of stream.current.getTracks()) track.stop()
          stream.current = null
        }
      }
      rec.start()

      // Tick the timer; auto-stop at MAX_SECONDS.
      tickTimer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            stopRecording()
            return MAX_SECONDS
          }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording.')
      setPhase('error')
    }
  }

  function stopRecording() {
    if (tickTimer.current) { clearInterval(tickTimer.current); tickTimer.current = null }
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop()
    }
  }

  function discardAndRetry() {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedBlob(null)
    setRecordedUrl(null)
    setSeconds(0)
    setPhase('idle')
  }

  async function save() {
    if (!recordedBlob) return
    setPhase('saving')
    setError(null)
    const fd = new FormData()
    fd.append('userId', targetUserId)
    // Include a filename so the server action's File detection works.
    const ext = recordedBlob.type.includes('mp4') ? 'm4a'
      : recordedBlob.type.includes('ogg') ? 'ogg'
      : 'webm'
    fd.append('audio', new File([recordedBlob], `memo.${ext}`, { type: recordedBlob.type }))
    const res = await uploadVoiceMemo(fd)
    if (res?.error) {
      setError(res.error)
      setPhase('recorded')
      return
    }
    router.refresh()
    onClose()
  }

  async function removeExisting() {
    if (!confirm(`Remove ${targetName}'s voice memo?`)) return
    setRemoving(true)
    const res = await removeVoiceMemo(targetUserId)
    setRemoving(false)
    if (res?.error) { setError(res.error); return }
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => phase === 'idle' && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100">
            <Mic size={15} className="text-pink-400" />
            Voice memo for {targetName}
          </h2>
          <button type="button" onClick={onClose} disabled={phase === 'recording' || phase === 'saving'} className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-50" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {phase === 'idle' && currentMemoUrl && (
            <div className="rounded-lg border border-stone-700 bg-stone-800/40 p-3">
              <p className="text-xs text-stone-400 mb-2">Current memo:</p>
              <audio controls src={currentMemoUrl} className="w-full" />
            </div>
          )}

          {phase === 'idle' && (
            <>
              <p className="text-sm text-stone-300 leading-relaxed">
                Record a short greeting (up to {MAX_SECONDS}s) for {targetName}. They&rsquo;ll
                hear it when someone 5-taps their family avatar on the dashboard. The
                old voice memo (if any) will be replaced.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={startRecording}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg transition"
                >
                  <Mic size={14} />
                  Start recording
                </button>
                {currentMemoUrl && (
                  <button
                    type="button"
                    onClick={removeExisting}
                    disabled={removing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-red-900/30 text-stone-300 hover:text-red-300 border border-stone-700 hover:border-red-800/40 rounded-lg transition disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {removing ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            </>
          )}

          {phase === 'recording' && (
            <div className="text-center py-4">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-700/20 border-2 border-red-500/60 animate-pulse">
                <Mic size={28} className="text-red-400" />
              </div>
              <p className="text-2xl font-mono font-bold text-stone-100">
                {seconds}s <span className="text-stone-600 text-base font-normal">/ {MAX_SECONDS}s</span>
              </p>
              <p className="mt-3 text-xs text-stone-400">Speak now. Tap Stop when you&rsquo;re done.</p>
              <button
                type="button"
                onClick={stopRecording}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-stone-700 hover:bg-stone-600 text-white rounded-lg transition"
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          )}

          {phase === 'recorded' && recordedUrl && (
            <div className="space-y-3">
              <p className="text-sm text-stone-300">
                {seconds}s recorded. Listen back, then save or re-record.
              </p>
              <audio controls autoPlay src={recordedUrl} className="w-full" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
                >
                  <Save size={14} />
                  Save memo
                </button>
                <button
                  type="button"
                  onClick={discardAndRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg transition"
                >
                  <RotateCcw size={14} />
                  Re-record
                </button>
              </div>
            </div>
          )}

          {phase === 'saving' && (
            <div className="flex items-center gap-3 py-4">
              <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-stone-300">Uploading…</p>
            </div>
          )}

          {phase === 'denied' && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
              <p className="font-medium text-amber-200">Microphone permission denied.</p>
              <p className="mt-1 text-xs text-amber-100/80">
                Enable mic access for this site in your browser settings, then re-open this dialog.
              </p>
            </div>
          )}

          {error && phase !== 'recording' && phase !== 'saving' && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

interface PreviewableProps {
  audioElement: HTMLAudioElement | null
}

// (Reserved for future Listen-only previews on non-superuser pages.)
export function _UnusedAudioPreview(_p: PreviewableProps) { return null }
