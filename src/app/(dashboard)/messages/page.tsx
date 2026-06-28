import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Inbox, MailCheck } from 'lucide-react'
import { listInbox, markAllMessagesRead } from '@/lib/actions/messages'
import { HelpPopout } from '@/components/ui/help-popout'
import { MessageRow } from '@/components/ui/message-row'

export default async function MessagesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const inbox = await listInbox()
  const unreadCount = inbox.filter((m) => m.readAt === null).length

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
            <Inbox size={20} className="text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">Messages</h1>
              <HelpPopout
                title="Messages"
                sections={[
                  {
                    heading: 'What this is',
                    tips: [
                      { title: 'Family inbox', description: 'Lightweight messages between family members on the vault. Not a chat app — more like a note someone left for you.' },
                      { title: 'Read receipts', description: 'Sender sees when you\'ve read theirs. Your unread count shows on the hamburger badge.' },
                    ],
                  },
                  {
                    heading: 'Send + receive',
                    tips: [
                      { title: 'Compose', description: 'Pick a recipient from family, type the message, attach a voice memo if you want.' },
                      { title: 'Voice messages', description: 'Hit the mic to record. Plays inline; transcript appears if speech-to-text is available.' },
                      { title: 'Reply', description: 'Tap any message to reply. Threading is shallow — one back-and-forth is the norm.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              {inbox.length === 0
                ? 'No messages yet.'
                : `${inbox.length} message${inbox.length === 1 ? '' : 's'}${unreadCount > 0 ? ` · ${unreadCount} unread` : ''}`}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <form action={markAllMessagesRead}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg transition"
            >
              <MailCheck size={14} />
              Mark all read
            </button>
          </form>
        )}
      </div>

      {inbox.length === 0 ? (
        <div className="text-center py-16 text-stone-500 border border-stone-800 rounded-xl">
          <Inbox size={36} className="mx-auto mb-3 text-stone-600" />
          <p className="font-medium text-stone-400">Your inbox is empty.</p>
          <p className="text-sm mt-1">Family messages from the dashboard will land here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {inbox.map((m) => (
            <MessageRow key={m.id} message={m} currentUserId={session.user.id} />
          ))}
        </div>
      )}
    </div>
  )
}
