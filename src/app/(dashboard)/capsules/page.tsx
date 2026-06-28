import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { listCapsules, type CapsuleListItem } from '@/lib/actions/time-capsules'
import { TimeCapsulesPage } from '@/components/ui/time-capsules-page'

export default async function CapsulesPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  // Family list is independent of the capsules query and rarely fails, so
  // it stays in the parallel block. listCapsules() goes in its own try/catch
  // because a missing time_capsule table or an encryption-decode failure on
  // a malformed row would otherwise 500 the whole page with no recovery.
  const family = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .orderBy(asc(users.createdAt))

  let capsules: CapsuleListItem[] = []
  let loadError: string | null = null
  try {
    capsules = await listCapsules()
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not load capsules.'
    console.warn('[capsules] load failed:', err)
  }

  return (
    <TimeCapsulesPage
      family={family}
      initialCapsules={capsules}
      currentUserId={session.user.id}
      loadError={loadError}
    />
  )
}
