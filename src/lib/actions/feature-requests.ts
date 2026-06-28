'use server'

import { eq, ne, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, messages } from '@/lib/db/schema'
import { encrypt } from '@/lib/crypto'

const MAX_LENGTH = 4000

// Feature requests land in every superuser's /messages inbox so admins see
// them next time they open the vault. Tagged with a "FEATURE REQUEST:"
// prefix so they're easy to scan in the inbox without changing the
// messages schema.
export async function submitFeatureRequest(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) return { error: 'You need to be signed in.' }

  const message = ((formData.get('message') as string) ?? '').trim().slice(0, MAX_LENGTH)
  if (!message) return { error: 'Tell me what you want to see.' }

  // Send to every superuser EXCEPT the submitter. If the submitter is the
  // only superuser, fall back to sending it to themselves so the request
  // is at least preserved somewhere they can find it.
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'superuser'), ne(users.id, session.user.id)))

  const targetIds = recipients.length > 0 ? recipients.map((r) => r.id) : [session.user.id]

  const senderName = session.user.name ?? session.user.email ?? 'A family member'
  const body = `FEATURE REQUEST from ${senderName}:\n\n${message}`
  const encrypted = encrypt(body) ?? body

  await db.insert(messages).values(
    targetIds.map((toUserId) => ({
      fromUserId: session.user.id,
      toUserId,
      body: encrypted,
    })),
  )

  revalidatePath('/messages')
  revalidatePath('/dashboard')
  return { success: true }
}
