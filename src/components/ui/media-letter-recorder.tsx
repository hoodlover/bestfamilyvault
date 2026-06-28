'use client'

// In-page audio + video recorder for the letters form. Records via
// MediaRecorder, lets the user preview, then hands the resulting File back
// to the parent form. The parent attaches it to the letter on save (the
// existing createLetter action already accepts arbitrary files).
//
// Two flavors share this single component, switched by the `mode` prop:
//   • mode="audio" — getUserMedia({audio:true}). Recording UI is a big
//     pulsing mic + timer.
//   • mode="video" — getUserMedia({video:true,audio:true}). Live <video>
//     preview during record (back camera on mobile when available), then
//     a playback <video> when finished.

import { useEffect, useRef, useState } from 'react'
import { Mic, Square, RotateCcw, Save, Video, X } from 'lucide-react'

const MAX_AUDIO_SECONDS = 5 * 60     // 5 minutes
const MAX_VIDEO_SECONDS = 3 * 60     // 3 minutes (storage / mobile bandwidth)

type Phase = 'idle' | 'recording' | 'recorded' | 'denied' | 'error'

interface Props {
  mode: 'audio' | 'video'
  /** Friendly name of the recipient — used in the modal title. */
  recipientName: string
  /** Called with the finished File when the user taps Save. The parent
   *  form is responsible for actually uploading it. */
  onSave: (file: File) => void
  onClose: () => void
}

export function MediaLetterRecorder({ mode, recipientName, onSave, onClose }: Props) {
  const isVideo = mode === 'video'
  const maxSeconds = isVideo ? MAX_VIDEO_SECONDS : MAX_AUDIO_SECONDS

  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  // Mirror the active stream into state too so a useEffect can re-run when
  // the live <video> element mounts and attach srcObject. The ref alone
  // wasn't enough — setting srcObject before React committed the DOM had
  // nothing to attach to, which is why preview was blank during recording.
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)

  // Cleanup on unmount: stop in-flight recording, release camera/mic
  // hardware tracks, revoke the playback object URL.
  useEffect(() => {
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current)
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop()
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire the live preview every time we have BOTH an active stream AND
  // the <video> element rendered in the DOM. Runs after React commits
  // the recording-phase render, so the ref is guaranteed to be there.
  useEffect(() => {
    if (!isVideo || !activeStream || !liveVideoRef.current) return
    const el = liveVideoRef.current
    el.srcObject = activeStream
    el.muted = true
    el.playsInline = true
    el.play().catch(() => {/* needs user gesture in some browsers */})
    return () => {
      el.srcObject = null
    }
  }, [isVideo, activeStream])

  async function startRecording() {
    setError(null)
    setSeconds(0)
    chunks.current = []

    // Love letters use the FRONT (selfie) camera so the user can see their
    // face while recording. Card / ID scans go through CameraCapture
    // separately and default to the back camera. `ideal` lets the browser
    // fall back gracefully if a device only exposes one camera.
    const constraints: MediaStreamConstraints = isVideo
      ? { audio: true, video: { facingMode: { ideal: 'user' } } }
      : { audio: true }

    let mediaStream: MediaStream
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      setPhase('denied')
      return
    }
    streamRef.current = mediaStream
    setActiveStream(mediaStream)

    // Show the recording UI; the live-preview useEffect picks up activeStream
    // once the <video> element is rendered.
    setPhase('recording')

    // Pick the best mime the browser will let us use. WebM/VP9 + Opus is
    // the usual winner; iOS Safari falls back to mp4/H.264 + AAC.
    const candidates = isVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''

    try {
      const rec = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined)
      mediaRecorder.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunks.current, { type: mime || (isVideo ? 'video/webm' : 'audio/webm') })
        setRecordedBlob(blob)
        setRecordedUrl(URL.createObjectURL(blob))
        setPhase('recorded')
        // Release the mic / camera now that we're done.
        if (streamRef.current) {
          for (const track of streamRef.current.getTracks()) track.stop()
          streamRef.current = null
        }
        setActiveStream(null)
      }
      rec.start()

      tickTimer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= maxSeconds) {
            stopRecording()
            return maxSeconds
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

  function save() {
    if (!recordedBlob) return
    // Pick a filename + extension consistent with the recorded mime.
    const ext = recordedBlob.type.includes('mp4')
      ? (isVideo ? 'mp4' : 'm4a')
      : recordedBlob.type.includes('ogg')
        ? 'ogg'
        : 'webm'
    const baseName = isVideo ? 'love-letter-video' : 'love-letter-audio'
    const file = new File([recordedBlob], `${baseName}-${Date.now()}.${ext}`, { type: recordedBlob.type })
    onSave(file)
    onClose()
  }

  const tone = isVideo ? 'sky' : 'pink'
  const Icon = isVideo ? Video : Mic
  const label = isVideo ? 'Video letter' : 'Voice letter'

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4"
      onClick={() => phase === 'idle' && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl flex flex-col max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed-position centered modal needs an explicit max-height +
            scrollable body, otherwise the recorded video preview pushes
            the Save / Re-record buttons off the bottom of the viewport
            and the user can't reach them. dvh accounts for the mobile
            URL bar; calc subtracts the outer p-4 padding so the corners
            stay rounded. */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-100">
            <Icon size={15} className={tone === 'sky' ? 'text-sky-400' : 'text-pink-400'} />
            {label} for {recipientName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === 'recording'}
            aria-label="Close"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4 overflow-y-auto">
          {phase === 'idle' && (
            <>
              <p className="text-sm text-stone-300 leading-relaxed">
                Record up to {Math.round(maxSeconds / 60)} minute{maxSeconds >= 120 ? 's' : ''} of {isVideo ? 'video' : 'audio'} for {recipientName}.
                {' '}You&rsquo;ll be able to listen / watch back before saving.
              </p>
              <button
                type="button"
                onClick={startRecording}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg transition"
              >
                <Icon size={14} />
                Start recording
              </button>
            </>
          )}

          {phase === 'recording' && (
            <div className="text-center py-2">
              {isVideo ? (
                <div className="relative mx-auto mb-3 max-w-full overflow-hidden rounded-lg border border-red-500/60 bg-black">
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    muted
                    playsInline
                    // Mirror the preview horizontally so the live view feels
                    // like a mirror (matching every other selfie UI). The
                    // recorded file itself is unmirrored — playback shows
                    // the real orientation.
                    className="block w-full max-h-48 sm:max-h-72 object-contain scale-x-[-1]"
                  />
                  <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium bg-red-700/80 text-white rounded-full">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    REC
                  </div>
                </div>
              ) : (
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-red-700/20 border-2 border-red-500/60 animate-pulse">
                  <Mic size={28} className="text-red-400" />
                </div>
              )}
              <p className="text-2xl font-mono font-bold text-stone-100">
                {fmtTime(seconds)} <span className="text-stone-600 text-base font-normal">/ {fmtTime(maxSeconds)}</span>
              </p>
              <p className="mt-2 text-xs text-stone-400">
                {isVideo ? 'Talk to the camera. Tap Stop when you’re done.' : 'Speak now. Tap Stop when you’re done.'}
              </p>
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
              {/* Save + Re-record sit at the TOP of the recorded view so
                  they're visible the instant recording finishes. The
                  playback preview goes below — scroll to watch/listen,
                  but the action buttons never disappear off-screen. */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-md"
                >
                  <Save size={15} />
                  Save
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
              <p className="text-sm text-stone-300">
                {fmtTime(seconds)} recorded. {isVideo ? 'Watch' : 'Listen'} back below, then Save above when ready.
              </p>
              {isVideo ? (
                <video controls src={recordedUrl} className="w-full max-h-48 sm:max-h-72 rounded-lg bg-black" />
              ) : (
                <audio controls src={recordedUrl} className="w-full" />
              )}
            </div>
          )}

          {phase === 'denied' && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
              <p className="font-medium text-amber-200">
                {isVideo ? 'Camera or microphone' : 'Microphone'} permission denied.
              </p>
              <p className="mt-1 text-xs text-amber-100/80">
                Enable {isVideo ? 'camera + mic' : 'mic'} access for this site in your browser settings, then re-open this dialog.
              </p>
            </div>
          )}

          {error && phase !== 'recording' && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
