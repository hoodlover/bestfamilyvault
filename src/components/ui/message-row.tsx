'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Trash2, MailOpen, Send } from 'lucide-react'
import { deleteMessage, markMessageRead, sendMessage } from '@/lib/actions/messages'

interface Props {
  message: {
    id: string
    body: string | null
    voiceMemoBlobUrl?: string | null
    voiceMemoContentType?: string | null
    voiceMemoDurationSec?: number | null
    readAt: Date | null
    createdAt: Date
    fromUserId: string
    fromName: string | null
    fromEmail: string | null
    fromImage: string | null
  }
  currentUserId: string
}

function initialOf(name: string | null, email: string | null) {
  return (name ?? email ?? '?').trim().charAt(0).toUpperCase() || '?'
}

export function MessageRow({ message, currentUserId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sender = message.fromName ?? message.fromEmail ?? 'Unknown'
  const ts = new Date(message.createdAt).toLocaleString()
  const unread = message.readAt === null
  const initial = initialOf(message.fromName, message.fromEmail)
  const avatarSrc = message.fromImage
    ? `/api/avatars/${message.fromUserId}?v=${message.createdAt.getTime()}`
    : null

  function markRead() {
    if (!unread) return
    startTransition(async () => {
      await markMessageRead(message.id)
      router.refresh()
    })
  }

  function remove() {
    if (!confirm('Delete this message?')) return
    startTransition(async () => {
      await deleteMessage(message.id)
      router.refresh()
    })
  }

  function startReply() {
    setReplying(true)
    if (unread) markRead()
  }

  function submitReply(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('toUserId', message.fromUserId)
      fd.append('body', reply)
      const result = await sendMessage(fd)
      if (result?.error) {
        setError(result.error)
        return
      }
      setReply('')
      setReplying(false)
      router.refresh()
    })
  }

  return (
    <div
      className={`p-4 rounded-xl border ${
        unread
          ? 'bg-emerald-950/20 border-emerald-800/40'
          : 'bg-stone-800/40 border-stone-700/50'
      }`}
      onClick={markRead}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden bg-stone-700 border border-stone-600 flex items-center justify-center">
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-sm font-semibold text-stone-200">{initial}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-stone-100 truncate">{sender}</span>
            {unread && <span className="text-[10px] uppercase tracking-wider text-emerald-300">New</span>}
            <span className="ml-auto text-xs text-stone-500">{ts}</span>
          </div>
          {message.body && (
            <p className="mt-2 text-sm text-stone-200 whitespace-pre-wrap break-words">{message.body}</p>
          )}
          {message.voiceMemoBlobUrl && (
            <div className="mt-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                controls
                preload="none"
                src={`/api/message-audio/${message.id}`}
                className="w-full"
              />
              {message.voiceMemoDurationSec ? (
                <p className="mt-1 text-[10px] uppercase tracking-wider text-stone-500">
                  Voice memo · {message.voiceMemoDurationSec}s
                </p>
              ) : (
                <p className="mt-1 text-[10px] uppercase tracking-wider text-stone-500">Voice memo</p>
              )}
            </div>
          )}

          {replying && (
            <form onSubmit={submitReply} className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <textarea
                rows={3}
                maxLength={2000}
                autoFocus
                required
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply to ${sender.split(' ')[0]}...`}
                className="w-full px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg text-stone-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600"
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setReplying(false); setReply(''); setError(null) }}
                  disabled={pending}
                  className="px-3 py-1.5 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition border border-stone-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending || !reply.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:opacity-60 text-white rounded-lg transition"
                >
                  <Send size={12} />
                  Send reply
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {!replying && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          {unread && (
            <button
              type="button"
              onClick={markRead}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium rounded-lg transition border border-stone-700"
            >
              <Check size={13} />
              Mark read
            </button>
          )}
          {message.fromUserId !== currentUserId && (
            <button
              type="button"
              onClick={startReply}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition"
            >
              <MailOpen size={13} />
              Reply
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-red-900/40 text-stone-400 hover:text-red-300 border border-stone-700 hover:border-red-800/50 text-xs font-medium rounded-lg transition"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
