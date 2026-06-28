import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { NewCapsuleForm } from '@/components/ui/new-capsule-form'
import { LockEgg } from '@/components/ui/lock-egg'
import { HelpPopout } from '@/components/ui/help-popout'

export default async function NewCapsulePage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/capsules')

  const family = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .orderBy(asc(users.createdAt))

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link href="/capsules" className="hover:text-stone-300 transition">Time Capsules</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">New</span>
      </nav>

      <h1 className="flex items-center gap-3 text-2xl font-bold text-stone-100 mb-1">
        <LockEgg src="/icons/cobb/icons/system/add_time_capsule.png" />
        New time capsule
        <HelpPopout
          title="New time capsule"
          sections={[
            {
              heading: 'What you\'re creating',
              tips: [
                { title: 'A sealed note', description: 'Body is AES-encrypted at rest. Even an admin reading the DB can\'t peek before the unlock date.' },
                { title: 'For one person or many', description: 'Pick a specific family member, or "all family" — anyone unlocks after the date arrives.' },
              ],
            },
            {
              heading: 'Pick the unlock',
              tips: [
                { title: 'Date in the future', description: 'When the date arrives, the recipient(s) see the capsule on /capsules. No notification beyond the regular "new things" badge.' },
                { title: 'You can force-release', description: 'Sender can override on the capsule detail page — useful if the moment came early.' },
              ],
            },
            {
              heading: 'What to put in',
              tips: [
                { title: 'Anything text', description: 'Reflections, a memory, instructions for the future. No length limit beyond reasonable storage.' },
                { title: 'Attachments', description: 'Photos, voice memos, video — they unlock alongside the body when the date arrives.' },
              ],
            },
          ]}
        />
      </h1>
      <p className="text-sm text-stone-400 mb-6">
        Write a sealed note today. The vault keeps it locked until the date you pick.
      </p>

      <NewCapsuleForm
        family={family}
        currentUserId={session.user.id}
      />
    </div>
  )
}
