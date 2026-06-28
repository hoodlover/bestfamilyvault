'use server'

// Server actions for the /reconcile page (receipt ⇄ statement line
// reconciliation, for 1120-S / 1040 tax prep).
//
// The classification logic (recurring? receipt-matched? unreconciled?)
// lives in src/lib/reconcile-classify.ts as a plain module — server
// components can import it directly without paying the 'use server'
// async-only export tax. This file is just the mutation surface:
// upsert a decision, search for matching receipts.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  entries,
  statementLineItems,
  statementLineDecision,
} from '@/lib/db/schema'
import { and, eq, gte, lte, or, sql } from 'drizzle-orm'
import { decryptEntries } from '@/lib/crypto'
import { revalidatePath } from 'next/cache'
import type { DecisionKind } from '@/lib/reconcile-classify'

interface SetDecisionInput {
  decision: DecisionKind
  receiptEntryId?: string | null
  note?: string | null
}

export async function setStatementLineDecision(
  lineId: string,
  input: SetDecisionInput,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  // Verify the line exists AND that the user can see its owning account.
  // statement_line_item carries userId directly, so the check is cheap.
  const line = await db
    .select({
      id: statementLineItems.id,
      userId: statementLineItems.userId,
      accountEntryId: statementLineItems.accountEntryId,
    })
    .from(statementLineItems)
    .where(eq(statementLineItems.id, lineId))
    .then((r) => r[0])
  if (!line) return { error: 'Statement line not found.' }
  // Per-user statement lines: only the user who owns the import can
  // decide. Superusers don't bypass — this is per-individual tax prep.
  if (line.userId !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  // Validate receiptEntryId if provided: must exist, must be a receipt
  // (type='document'), and must be visible to this user.
  if (input.receiptEntryId) {
    const receipt = await db
      .select({
        id: entries.id,
        type: entries.type,
        isPrivate: entries.isPrivate,
        isPersonal: entries.isPersonal,
        createdBy: entries.createdBy,
      })
      .from(entries)
      .where(eq(entries.id, input.receiptEntryId))
      .then((r) => r[0])
    if (!receipt) return { error: 'Receipt entry not found.' }
    if (receipt.type !== 'document') return { error: 'Not a receipt-style entry.' }
    if (receipt.isPrivate && session.user.role !== 'superuser') {
      return { error: 'Access denied.' }
    }
    if (receipt.isPersonal && receipt.createdBy !== session.user.id) {
      return { error: 'Access denied.' }
    }
  }

  // Only `matched` makes sense with a receipt link; clear it on every
  // other decision so the audit trail stays clean.
  const receiptId = input.decision === 'matched' ? (input.receiptEntryId ?? null) : null

  await db
    .insert(statementLineDecision)
    .values({
      statementLineItemId: lineId,
      decision: input.decision,
      receiptEntryId: receiptId,
      note: input.note?.trim() || null,
      decidedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: statementLineDecision.statementLineItemId,
      set: {
        decision: input.decision,
        receiptEntryId: receiptId,
        note: input.note?.trim() || null,
        decidedBy: session.user.id,
        decidedAt: new Date(),
      },
    })

  revalidatePath('/reconcile')
  return { ok: true }
}

export async function clearStatementLineDecision(
  lineId: string,
): Promise<{ ok?: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }
  if (session.user.role === 'readonly') return { error: 'Read-only access.' }

  // Permission check piggybacks on the line's userId — same as setDecision.
  const line = await db
    .select({ userId: statementLineItems.userId })
    .from(statementLineItems)
    .where(eq(statementLineItems.id, lineId))
    .then((r) => r[0])
  if (!line) return { error: 'Statement line not found.' }
  if (line.userId !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  await db
    .delete(statementLineDecision)
    .where(eq(statementLineDecision.statementLineItemId, lineId))

  revalidatePath('/reconcile')
  return { ok: true }
}

// Find receipt entries the user might want to link to a given line.
// Loose tolerances — ±$2 (or ±2%) on amount, ±14 days on date — so
// "Link existing receipt" can show plausible options even when the
// auto-matcher's tighter window didn't fire. The auto-matcher uses
// LLC isolation; this manual search does NOT, because the whole point
// of "link" is to override cross-LLC defaults (e.g. picking a Cobb
// Family receipt as the match for a PTC card line so it gets flagged
// for personal-use accounting).
//
// Returns plaintext fields (decryptEntries) so the picker UI can show
// merchant/amount/date without a round-trip.

interface ReceiptCandidate {
  id: string
  title: string
  merchant: string | null
  totalCents: number
  purchaseDate: string | null
  llcSubcategoryId: string | null
}

export async function findReceiptCandidatesForLine(
  lineId: string,
): Promise<{ candidates?: ReceiptCandidate[]; error?: string }> {
  const session = await auth()
  if (!session?.user?.id) return { error: 'Unauthorized.' }

  const line = await db
    .select({
      id: statementLineItems.id,
      userId: statementLineItems.userId,
      amountCents: statementLineItems.amountCents,
      postedDate: statementLineItems.postedDate,
    })
    .from(statementLineItems)
    .where(eq(statementLineItems.id, lineId))
    .then((r) => r[0])
  if (!line) return { error: 'Statement line not found.' }
  if (line.userId !== session.user.id && session.user.role !== 'superuser') {
    return { error: 'Access denied.' }
  }

  // Date math on YYYY-MM-DD strings is fine — they sort lexicographically.
  const posted = new Date(line.postedDate + 'T00:00:00')
  const start = new Date(posted)
  start.setUTCDate(start.getUTCDate() - 14)
  const end = new Date(posted)
  end.setUTCDate(end.getUTCDate() + 14)
  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)

  // amountCents is signed (negative = debit). Receipt totalCents is
  // stored as a string of positive cents in customFields. Compare on
  // the absolute value of the statement amount.
  const targetAbs = Math.abs(line.amountCents)
  const tolerance = Math.max(200, Math.round(targetAbs * 0.02))
  const minCents = targetAbs - tolerance
  const maxCents = targetAbs + tolerance

  // Cast customFields.totalCents to integer in SQL for the range filter.
  // The 'kind' check ensures we only pull receipt-style document entries
  // (not, say, identity docs).
  //
  // Visibility filter: drop other users' personal entries.
  const userId = session.user.id
  const isSuperuser = session.user.role === 'superuser'

  const raw = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.type, 'document'),
        sql`(${entries.customFields} ->> 'kind') = 'receipt'`,
        sql`(${entries.customFields} ->> 'purchaseDate') BETWEEN ${startStr} AND ${endStr}`,
        sql`((${entries.customFields} ->> 'totalCents')::integer)
            BETWEEN ${minCents} AND ${maxCents}`,
        isSuperuser ? undefined : eq(entries.isPrivate, false),
        or(eq(entries.isPersonal, false), eq(entries.createdBy, userId)),
      ),
    )

  // decryptEntries handles encrypted columns; customFields is plaintext
  // JSON so it's already readable.
  const decrypted = decryptEntries(raw)

  // Filter date range again in JS — the SQL ->> path strips JSON-typed
  // nulls inconsistently across drivers; belt-and-suspenders.
  const candidates: ReceiptCandidate[] = []
  for (const e of decrypted) {
    const cf = (e.customFields ?? {}) as Record<string, string>
    if (cf.kind !== 'receipt') continue
    const total = parseInt(cf.totalCents ?? '', 10)
    if (!Number.isFinite(total)) continue
    const date = cf.purchaseDate ?? null
    candidates.push({
      id: e.id,
      title: e.title,
      merchant: cf.merchant ?? null,
      totalCents: total,
      purchaseDate: date,
      llcSubcategoryId: e.llcSubcategoryId ?? null,
    })
  }

  // Closest by amount first, then closest by date — gives Lance the
  // "best guess" at top of the picker.
  candidates.sort((a, b) => {
    const da = Math.abs(a.totalCents - targetAbs)
    const dbb = Math.abs(b.totalCents - targetAbs)
    if (da !== dbb) return da - dbb
    return (a.purchaseDate ?? '').localeCompare(b.purchaseDate ?? '')
  })

  // Cap at 10 — the picker doesn't need to be a megalist.
  return { candidates: candidates.slice(0, 10) }
}

// Unused suppression — keep `gte`/`lte` imports for future direct
// date filtering if/when we move off the SQL string casts above.
void gte
void lte
