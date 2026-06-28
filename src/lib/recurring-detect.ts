// Recurring-charge detection.
//
// Walks every parsed statement line item for a user, groups by
// normalizedMerchant within an account, and flags merchants that look
// recurring on a stable cadence with a stable amount. The output feeds
// the recurring_suggestion table.
//
// Heuristics, not ML — kept deliberately simple so the failure modes are
// debuggable. The review queue is the safety net.

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  entries,
  recurringSuggestions,
  statementLineItems,
} from '@/lib/db/schema'

export interface RecurringCandidate {
  accountEntryId: string
  llcSubcategoryId: string | null
  normalizedMerchant: string
  displayName: string
  typicalAmountCents: number
  period: 'monthly' | 'yearly'
  firstSeenAt: string  // YYYY-MM-DD
  lastSeenAt: string
  occurrenceCount: number
  predictedNextAt: string
}

// ─── Merchant normalization ─────────────────────────────────────────────────
//
// Statement descriptions are noisy: "NETFLIX.COM 866-579-7172 CA",
// "AMZN MKTP US*1A2B3 SEATTLE WA", "PAYPAL *FIGMA INC". The goal is
// "two charges from the same merchant collapse to the same string."
//
// Best-effort regex — wrong on tricky cases (e.g. "PAYPAL *FIGMA" should
// arguably bucket as figma, not paypal). The review queue catches the
// edge cases. v2 could swap in LLM-based normalization.

const STRIP_SUFFIXES = [
  /\.com\b/gi,
  /\binc\b/gi,
  /\bllc\b/gi,
  /\bsubscription\b/gi,
  /\bpurchase\b/gi,
  /\brecurring\b/gi,
  /\bauthorized\b/gi,
]

// Trailing 4+ digit IDs ("amzn mktp us*1a2b3"), US state codes,
// and date-like tokens at the tail end.
const TRIM_TAILS = [
  /\b[A-Z]{2}\s*$/i,                       // trailing state code
  /\b\d{2}\/\d{2}(\/\d{2,4})?\s*$/,        // trailing date
  /\b\d{4,}\b/g,                            // long digit groups
  /\*\S+/g,                                 // "*tagged" subaccount markers
  /#\d+/g,                                  // "#1234"
  /[-_]+/g,                                 // collapse dashes/underscores
]

export function normalizeMerchant(raw: string): string {
  let s = raw.toLowerCase()
  for (const re of STRIP_SUFFIXES) s = s.replace(re, ' ')
  for (const re of TRIM_TAILS) s = s.replace(re, ' ')
  // Collapse runs of whitespace, strip leading/trailing punctuation.
  s = s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

// ─── Detection per user ─────────────────────────────────────────────────────

const msPerDay = 24 * 60 * 60 * 1000

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mad(nums: number[]): number {
  const m = median(nums)
  return median(nums.map((n) => Math.abs(n - m)))
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

interface RowLite {
  accountEntryId: string
  postedDate: string
  rawDescription: string
  normalizedMerchant: string
  amountCents: number
  llcSubcategoryId: string | null
}

export async function detectRecurringForUser(userId: string): Promise<RecurringCandidate[]> {
  // All txns for this user, joined to account llc tag.
  const rows = await db
    .select({
      accountEntryId: statementLineItems.accountEntryId,
      postedDate: statementLineItems.postedDate,
      rawDescription: statementLineItems.rawDescription,
      normalizedMerchant: statementLineItems.normalizedMerchant,
      amountCents: statementLineItems.amountCents,
      llcSubcategoryId: entries.llcSubcategoryId,
    })
    .from(statementLineItems)
    .innerJoin(entries, eq(entries.id, statementLineItems.accountEntryId))
    .where(eq(statementLineItems.userId, userId))

  // Group by (accountEntryId, normalizedMerchant).
  const groups = new Map<string, RowLite[]>()
  for (const r of rows) {
    const key = `${r.accountEntryId}::${r.normalizedMerchant}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }

  const candidates: RecurringCandidate[] = []

  for (const [, txns] of groups) {
    if (txns.length < 3) continue
    txns.sort((a, b) => a.postedDate.localeCompare(b.postedDate))

    // Only consider DEBITS (negative amounts). Credits to the account
    // (refunds, deposits) confuse pattern detection.
    const debits = txns.filter((t) => t.amountCents < 0)
    if (debits.length < 3) continue

    // Pairwise intervals between consecutive debit dates.
    const dates = debits.map((t) => new Date(t.postedDate + 'T12:00:00Z'))
    const intervals: number[] = []
    for (let i = 1; i < dates.length; i += 1) {
      const days = Math.round((dates[i].getTime() - dates[i - 1].getTime()) / msPerDay)
      if (days > 0) intervals.push(days)
    }
    if (intervals.length < 2) continue

    const medianInterval = median(intervals)
    const intervalSd = stddev(intervals)

    let period: 'monthly' | 'yearly'
    if (medianInterval >= 26 && medianInterval <= 34 && intervalSd < 5) {
      period = 'monthly'
    } else if (medianInterval >= 350 && medianInterval <= 380 && intervalSd < 14) {
      period = 'yearly'
    } else {
      continue
    }

    // Amounts (use absolute value — sign noise hurts MAD).
    const amounts = debits.map((t) => Math.abs(t.amountCents))
    const medianAmount = Math.round(median(amounts))
    const amountMad = mad(amounts)
    // < 20% MAD relative to median. Skips usage-based bills (electric, gas)
    // — accepted limitation for v1.
    if (medianAmount === 0 || amountMad / medianAmount > 0.2) continue

    const last = debits[debits.length - 1]
    const first = debits[0]
    const predictedNext = addDays(new Date(last.postedDate + 'T12:00:00Z'), Math.round(medianInterval))

    // Pick the longest raw description as the display name — usually the
    // most readable variant the merchant produced.
    const displayName = debits
      .map((t) => t.rawDescription)
      .reduce((a, b) => (a.length >= b.length ? a : b))

    candidates.push({
      accountEntryId: last.accountEntryId,
      llcSubcategoryId: last.llcSubcategoryId,
      normalizedMerchant: last.normalizedMerchant,
      displayName,
      typicalAmountCents: -medianAmount,           // restore the sign (debit)
      period,
      firstSeenAt: first.postedDate,
      lastSeenAt: last.postedDate,
      occurrenceCount: debits.length,
      predictedNextAt: ymd(predictedNext),
    })
  }

  return candidates
}

// ─── De-dup against existing recurring entries ──────────────────────────────
//
// Skip suggesting a charge that's already in the vault as an
// isRecurring=true entry. Fuzzy match by checking if the entry's title
// contains the normalized merchant token (or vice versa).

export async function filterAlreadyTracked(
  userId: string,
  candidates: RecurringCandidate[],
): Promise<RecurringCandidate[]> {
  if (candidates.length === 0) return []

  const existing = await db
    .select({ title: entries.title })
    .from(entries)
    .where(
      and(
        eq(entries.createdBy, userId),
        eq(entries.isRecurring, true),
      ),
    )

  const existingTokens = existing
    .map((e) => normalizeMerchant(e.title))
    .filter((t) => t.length >= 3)

  return candidates.filter((c) => {
    return !existingTokens.some((token) =>
      token.includes(c.normalizedMerchant) || c.normalizedMerchant.includes(token),
    )
  })
}

// ─── Upsert into recurring_suggestion ───────────────────────────────────────
//
// One row per (account, normalizedMerchant). Re-running the detector
// refreshes amount / lastSeenAt / predictedNextAt on the existing row
// without disturbing status (so an 'approved' or 'dismissed' suggestion
// stays in that state — important for the dismiss-as-noise workflow).

export async function upsertRecurringSuggestions(
  userId: string,
  candidates: RecurringCandidate[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0
  let updated = 0
  for (const c of candidates) {
    const existing = await db
      .select({ id: recurringSuggestions.id, status: recurringSuggestions.status })
      .from(recurringSuggestions)
      .where(
        and(
          eq(recurringSuggestions.accountEntryId, c.accountEntryId),
          eq(recurringSuggestions.normalizedMerchant, c.normalizedMerchant),
        ),
      )
      .limit(1)

    if (existing.length === 0) {
      await db.insert(recurringSuggestions).values({
        userId,
        accountEntryId: c.accountEntryId,
        llcSubcategoryId: c.llcSubcategoryId,
        normalizedMerchant: c.normalizedMerchant,
        displayName: c.displayName,
        typicalAmountCents: c.typicalAmountCents,
        period: c.period,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
        occurrenceCount: c.occurrenceCount,
        predictedNextAt: c.predictedNextAt,
        status: 'pending',
      })
      inserted += 1
    } else {
      // Refresh stats. Leave status alone — preserves dismissed/approved.
      await db
        .update(recurringSuggestions)
        .set({
          llcSubcategoryId: c.llcSubcategoryId,
          displayName: c.displayName,
          typicalAmountCents: c.typicalAmountCents,
          period: c.period,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
          occurrenceCount: c.occurrenceCount,
          predictedNextAt: c.predictedNextAt,
          updatedAt: new Date(),
        })
        .where(eq(recurringSuggestions.id, existing[0].id))
      updated += 1
    }
  }
  return { inserted, updated }
}

