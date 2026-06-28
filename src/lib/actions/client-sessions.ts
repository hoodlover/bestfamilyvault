'use server'

// Server actions backing the "Linked Devices" settings panel.
//
//   • listMyClientSessions  → list of paired clients for the signed-in user
//   • revokeClientSession   → tombstone a paired client (sets revokedAt;
//                             auth middleware then rejects its bearer)
//   • startPairCode         → mint a 6-digit pairing code (used by the
//                             web UI to display the pair-new-device modal)
//
// The actual pairing handshake (code → token swap) lives in the
// /api/clients/pair/complete route because it has to be reachable by
// the unauthenticated extension/app, which doesn't have a web session.

import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { clientSessions, clientPairCodes } from '@/lib/db/schema'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  return session
}

export interface ClientSessionRow {
  id: string
  name: string
  platform: string
  lastSeenAt: Date | null
  createdAt: Date
}

export async function listMyClientSessions(): Promise<ClientSessionRow[]> {
  const session = await requireUser()
  const rows = await db
    .select({
      id: clientSessions.id,
      name: clientSessions.name,
      platform: clientSessions.platform,
      lastSeenAt: clientSessions.lastSeenAt,
      createdAt: clientSessions.createdAt,
    })
    .from(clientSessions)
    .where(and(eq(clientSessions.userId, session.user.id), isNull(clientSessions.revokedAt)))
    .orderBy(asc(clientSessions.createdAt))
  return rows
}

export async function revokeClientSession(id: string) {
  const session = await requireUser()
  // Belt + suspenders: AND on userId so a leaked id from another user
  // can't tombstone someone else's session.
  await db
    .update(clientSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(clientSessions.id, id), eq(clientSessions.userId, session.user.id)))
  revalidatePath('/settings')
  return { success: true }
}

/** Inline-rename a paired device — lets the user disambiguate the
 *  several "Chrome — this device" rows that accumulate over time. */
export async function renameClientSession(id: string, name: string) {
  const session = await requireUser()
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) return { error: 'Name cannot be empty.' }
  await db
    .update(clientSessions)
    .set({ name: trimmed })
    .where(and(eq(clientSessions.id, id), eq(clientSessions.userId, session.user.id)))
  revalidatePath('/settings')
  return { success: true }
}

/**
 * Revoke every device that hasn't been seen in the past `staleDays` days
 * (default 30). Caller's own sessions only. Returns the count revoked
 * so the UI can confirm.
 */
export async function pruneStaleClientSessions(staleDays = 30): Promise<{ revoked: number }> {
  const session = await requireUser()
  const cutoff = new Date(Date.now() - staleDays * 86_400_000)
  // Anything where lastSeenAt is BEFORE the cutoff — OR null AND created
  // before the cutoff (never paired successfully / never used).
  const candidates = await db
    .select({ id: clientSessions.id, lastSeenAt: clientSessions.lastSeenAt, createdAt: clientSessions.createdAt })
    .from(clientSessions)
    .where(and(eq(clientSessions.userId, session.user.id), isNull(clientSessions.revokedAt)))

  const ids: string[] = []
  for (const r of candidates) {
    const lastTouched = r.lastSeenAt ?? r.createdAt
    if (lastTouched && lastTouched < cutoff) ids.push(r.id)
  }

  if (ids.length === 0) {
    return { revoked: 0 }
  }

  for (const id of ids) {
    await db
      .update(clientSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(clientSessions.id, id), eq(clientSessions.userId, session.user.id)))
  }
  revalidatePath('/settings')
  return { revoked: ids.length }
}

/**
 * Mint a fresh 6-digit pairing code for the current user. Codes live
 * 10 minutes. We retry once on the (very unlikely) collision with
 * another live unconsumed code.
 */
export async function startPairCode(): Promise<{ code: string; expiresAt: Date } | { error: string }> {
  let session
  try {
    session = await requireUser()
  } catch {
    return { error: 'Unauthorized' }
  }
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  // Avoid handing out a code that's still live (unconsumed + not expired)
  // even if it's another user's. Three tries should cover 1-in-a-million.
  for (let i = 0; i < 3; i++) {
    const code = mint6DigitCode()
    const conflict = await db
      .select({ code: clientPairCodes.code })
      .from(clientPairCodes)
      .where(and(
        eq(clientPairCodes.code, code),
        gt(clientPairCodes.expiresAt, new Date()),
        isNull(clientPairCodes.consumedAt),
      ))
      .then((r) => r[0])
    if (conflict) continue
    await db.insert(clientPairCodes).values({
      code,
      userId: session.user.id,
      expiresAt,
    })
    revalidatePath('/settings')
    return { code, expiresAt }
  }
  return { error: 'Could not generate a pairing code. Try again.' }
}

function mint6DigitCode(): string {
  // Crypto-strong but kept short for the UX. ~1 in a million chance
  // any two live codes collide, mitigated by the loop above.
  const n = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
  return n.toString().padStart(6, '0')
}
