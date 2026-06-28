'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Send, X, CheckCircle2, MessageCircle, Mic, Square, RotateCcw } from 'lucide-react'
import { sendMessage } from '@/lib/actions/messages'

const MAX_AUDIO_SECONDS = 60

interface FamilyMember {
  id: string
  name: string | null
  email: string | null
  hasImage: boolean
  updatedAt: number // ms — for cache-bust
  hasVoiceMemo?: boolean
}

interface Props {
  members: FamilyMember[]
  currentUserId: string
}

// Reduced 62% from 1.25" — these are dense ID-card sized chips on the home grid.
const AVATAR_PX = 46

function initialOf(name: string | null, email: string | null) {
  return (name ?? email ?? '?').trim().charAt(0).toUpperCase() || '?'
}

function avatarSrc(m: FamilyMember) {
  return m.hasImage ? `/api/avatars/${m.id}?v=${m.updatedAt}` : null
}

export function FamilyAvatarRow({ members, currentUserId }: Props) {
  const [target, setTarget] = useState<FamilyMember | null>(null)

  if (members.length === 0) return null

  return (
    <section className="mb-8 md:mb-10">
      <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
        Family
      </h2>
      <div className="flex flex-wrap items-center gap-4 md:gap-6">
        {members.map((m) => {
          const isMe = m.id === currentUserId
          const src = avatarSrc(m)
          return (
            <FamilyAvatar
              key={m.id}
              member={m}
              isMe={isMe}
              src={src}
              onMessage={() => setTarget(m)}
            />
          )
        })}
      </div>

      {target && (
        <SendMessageModal
          to={target}
          onClose={() => setTarget(null)}
        />
      )}
    </section>
  )
}

interface AvatarProps {
  member: FamilyMember
  isMe: boolean
  src: string | null
  onMessage: () => void
}

function FamilyAvatar({ member, isMe, src, onMessage }: AvatarProps) {
  const display = member.name?.split(' ')[0] ?? member.email ?? 'User'
  const initial = initialOf(member.name, member.email)
  const ringClass = isMe
    ? 'ring-2 ring-amber-500/70 hover:ring-amber-400'
    : 'ring-1 ring-stone-700 hover:ring-emerald-500/70'

  // 5-tap voice-memo egg. We can't both open the message modal AND play
  // the memo on the same click, so we debounce: a single tap opens the
  // message modal after a short pause, but a 5th tap within 1.5s of the
  // first cancels that and plays the memo instead.
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handleNonSelfTap() {
    tapCount.current += 1
    if (tapTimer.current) clearTimeout(tapTimer.current)

    if (false && tapCount.current >= 5 && member.hasVoiceMemo) {
      tapCount.current = 0
      // Lazy-create the <audio> element so we only fetch when triggered.
      const audio = audioRef.current ?? new Audio(`/api/voice-memos/${member.id}?t=${Date.now()}`)
      audioRef.current = audio
      audio.currentTime = 0
      audio.play().catch(() => {
        // Autoplay rules might block on iOS — surface it through the message
        // modal so the user gets feedback at least.
        onMessage()
      })
      return
    }

    tapTimer.current = setTimeout(() => {
      tapCount.current = 0
      onMessage()
    }, 600)
  }

  const inner = (
    <div className="flex flex-col items-center gap-2 group">
      <div
        className={`relative overflow-hidden rounded-full bg-stone-700 transition shadow-lg ${ringClass}`}
        style={{ width: AVATAR_PX, height: AVATAR_PX }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl font-semibold text-stone-300">
            {initial}
          </div>
        )}
        {!isMe && (
          <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 ring-2 ring-stone-900 opacity-0 group-hover:opacity-100 transition pointer-events-none">
            <MessageCircle size={11} className="text-white" />
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-stone-200 truncate max-w-[80px]">{display}</div>
        {isMe && <div className="text-[9px] uppercase tracking-wider text-amber-400">You</div>}
      </div>
    </div>
  )

  if (isMe) {
    return (
      <Link href="/settings" title="Edit your photo and settings">
        {inner}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={handleNonSelfTap}
      title={`Send ${display} a message`}
      className="cursor-pointer"
    >
      {inner}
    </button>
  )
}

interface ModalProps {
  to: FamilyMember
  onClose: () => void
}

type RecorderPhase = 'idle' | 'recording' | 'recorded' | 'denied'

function SendMessageModal({ to, onClose }: ModalProps) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const display = to.name ?? to.email ?? 'User'
  const src = avatarSrc(to)

  // Voice-memo recorder state.
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const audioDurationRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Cleanup on unmount: stop any in-flight recording, release stream + URL.
  useEffect(() => {
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop()
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startRecording() {
    setError(null)
    setSeconds(0)
    chunksRef.current = []
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setPhase('denied')
      return
    }
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    try {
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined)
      recorderRef.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        setPhase('recorded')
        if (streamRef.current) {
          for (const track of streamRef.current.getTracks()) track.stop()
          streamRef.current = null
        }
      }
      rec.start()
      setPhase('recording')
      tickTimerRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1
          audioDurationRef.current = next
          if (next >= MAX_AUDIO_SECONDS) {
            stopRecording()
            return MAX_AUDIO_SECONDS
          }
          return next
        })
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  function stopRecording() {
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  function discardAudio() {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setSeconds(0)
    audioDurationRef.current = 0
    setPhase('idle')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const fd = new FormData()
    fd.append('toUserId', to.id)
    fd.append('body', body)
    if (audioBlob) {
      const ext = audioBlob.type.includes('mp4') ? 'm4a'
        : audioBlob.type.includes('ogg') ? 'ogg'
        : 'webm'
      fd.append('audio', new File([audioBlob], `memo.${ext}`, { type: audioBlob.type }))
      fd.append('audioDurationSec', String(audioDurationRef.current || seconds || 1))
    }
    const result = await sendMessage(fd)
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-stone-700 border border-stone-600 flex items-center justify-center">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-semibold text-stone-200">{initialOf(to.name, to.email)}</span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-100 truncate">Send {display} a message</h2>
              {to.email && <p className="text-xs text-stone-500 truncate">{to.email}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="p-1 rounded text-stone-500 hover:text-stone-200 hover:bg-stone-800"
          >
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <p className="text-stone-200 font-medium">Message sent.</p>
            <p className="text-sm text-stone-400">{display} will see it next time they open the vault.</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg transition"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1.5">
                Message
              </label>
              <textarea
                rows={4}
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Hi ${display.split(' ')[0]}...`}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
              />
              <p className="mt-1 text-xs text-stone-500">{body.length} / 2000</p>
            </div>

            <div className="rounded-lg border border-stone-700 bg-stone-800/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">Voice memo</span>
                <span className="text-xs text-stone-500">up to {MAX_AUDIO_SECONDS}s</span>
              </div>

              {phase === 'idle' && !audioUrl && (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg transition disabled:opacity-50"
                >
                  <Mic size={13} />
                  Record voice memo
                </button>
              )}

              {phase === 'recording' && (
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-700/20 border border-red-500/60 animate-pulse">
                    <Mic size={14} className="text-red-400" />
                  </span>
                  <span className="font-mono text-sm text-stone-100">
                    {seconds}s <span className="text-stone-600 text-xs">/ {MAX_AUDIO_SECONDS}s</span>
                  </span>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-700 hover:bg-stone-600 text-white rounded-lg transition"
                  >
                    <Square size={12} />
                    Stop
                  </button>
                </div>
              )}

              {phase === 'recorded' && audioUrl && (
                <div className="space-y-2">
                  <audio controls src={audioUrl} className="w-full" />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={discardAudio}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg transition disabled:opacity-50"
                    >
                      <RotateCcw size={12} />
                      Re-record
                    </button>
                    <span className="text-xs text-stone-500 self-center">
                      {seconds}s recorded — will send with the message.
                    </span>
                  </div>
                </div>
              )}

              {phase === 'denied' && (
                <p className="text-xs text-amber-300">
                  Microphone permission denied. Enable mic access for this site in your browser settings to record.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy || phase === 'recording'}
                className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || phase === 'recording' || (!body.trim() && !audioBlob)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
              >
                {busy ? (
                  <>
                    <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
