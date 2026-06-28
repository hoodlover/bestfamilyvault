// Pure classification logic for the /reconcile page. Plain module, no
// 'use server' — so it can be imported from server components AND from
// the page's server-side render path without the async-only export
// constraint that bit us on the emergency-sheet tag.
//
// Inputs: a set of statement lines (already pulled), a set of approved
// recurring suggestions, a set of receipt entries, the user's LLC map.
// Output: one classification per line.

export type DecisionKind =
  | 'matched'
  | 'no_receipt_needed'
  | 'personal'
  | 'transfer'
  | 'atm_cash'

export type ClassificationKind =
  | 'recurring'         // auto: matched to an approved recurring suggestion
  | 'receipt_matched'   // auto: matched to a receipt entry, LLC agrees
  | 'cross_llc_matched' // auto: matched a receipt by amount+date but the
                        //       receipt's LLC ≠ the account's LLC — flagged
                        //       because this is exactly the "personal item
                        //       bought on business card" issue 1120-S prep
                        //       needs to catch
  | 'decided'           // manual: a statement_line_decision row exists
  | 'unreconciled'      // neither — Lance needs to look at this one

export interface Classification {
  kind: ClassificationKind
  // For 'recurring': the suggestion id we matched against.
  recurringSuggestionId?: string
  // For 'receipt_matched' / 'cross_llc_matched' (auto): the receipt entry.
  // For 'decided' with sub-decision='matched': the linked receipt id.
  receiptEntryId?: string
  // For 'cross_llc_matched': the receipt's LLC subcategory id (so the
  // UI can show "Filed as <name> but on <account-LLC> card").
  receiptLlcSubcategoryId?: string | null
  // For 'decided': which specific decision was recorded.
  decision?: DecisionKind
  decisionNote?: string | null
  decisionId?: string  // statement_line_item_id for editing/deleting
}

export interface InputLine {
  id: string
  accountEntryId: string
  postedDate: string         // YYYY-MM-DD
  amountCents: number        // signed; debits negative
  normalizedMerchant: string
  llcSubcategoryId: string | null  // resolved from the account entry
}

export interface InputRecurring {
  id: string
  accountEntryId: string
  normalizedMerchant: string
}

export interface InputReceipt {
  id: string
  llcSubcategoryId: string | null
  totalCents: number          // positive cents from customFields.totalCents
  purchaseDate: string | null // YYYY-MM-DD
  merchant: string | null     // raw merchant string from customFields.merchant
  normalizedMerchant: string | null // optional, computed by caller via normalizeMerchant()
}

export interface InputDecision {
  statementLineItemId: string
  decision: DecisionKind
  receiptEntryId: string | null
  note: string | null
}

// Merchants whose statement-post date routinely drifts 5-7 days from the
// receipt date. Use a wider tolerance for these. Sourced from real
// patterns (Amazon ship → post drift, PayPal funding-delay, Square
// batched same-day settlement).
const SLOW_POST_MERCHANTS = new Set([
  'amazon',
  'amazon mktp',
  'amzn mktp',
  'paypal',
  'square',
  'sq',
])

function dateDiffDays(a: string, b: string): number {
  // YYYY-MM-DD only — UTC arithmetic to avoid local-time offsets.
  const aT = Date.UTC(
    parseInt(a.slice(0, 4), 10),
    parseInt(a.slice(5, 7), 10) - 1,
    parseInt(a.slice(8, 10), 10),
  )
  const bT = Date.UTC(
    parseInt(b.slice(0, 4), 10),
    parseInt(b.slice(5, 7), 10) - 1,
    parseInt(b.slice(8, 10), 10),
  )
  return Math.abs(aT - bT) / 86_400_000
}

function isSlowPostMerchant(normalized: string): boolean {
  if (!normalized) return false
  for (const tag of SLOW_POST_MERCHANTS) {
    if (normalized.includes(tag)) return true
  }
  return false
}

/**
 * Classify a single statement line. Order of precedence:
 *   1. Explicit user decision (statement_line_decision row) — always wins
 *   2. Recurring match (approved suggestion with same account+normalizedMerchant)
 *   3. Receipt match (LLC matches, amount within tolerance, date within window)
 *   4. Unreconciled
 *
 * Tolerances per plan:
 *   - Amount: |receipt - |line|| ≤ max($2, 2%)
 *   - Date: ±7 days for known slow-post merchants, ±3 days otherwise
 *   - LLC isolation is REQUIRED for receipt match (cross-LLC = unreconciled)
 */
export function classifyLine(
  line: InputLine,
  recurrings: InputRecurring[],
  receipts: InputReceipt[],
  decisions: Map<string, InputDecision>,
): Classification {
  // 1. Manual decision wins.
  const decision = decisions.get(line.id)
  if (decision) {
    return {
      kind: 'decided',
      decision: decision.decision,
      receiptEntryId: decision.receiptEntryId ?? undefined,
      decisionNote: decision.note,
      decisionId: decision.statementLineItemId,
    }
  }

  // 2. Recurring auto-match — same account, same normalized merchant.
  // Empty normalizedMerchant short-circuits to avoid matching a bunch
  // of random "" rows together.
  if (line.normalizedMerchant) {
    const r = recurrings.find(
      (r) =>
        r.accountEntryId === line.accountEntryId &&
        r.normalizedMerchant === line.normalizedMerchant,
    )
    if (r) {
      return { kind: 'recurring', recurringSuggestionId: r.id }
    }
  }

  // 3. Receipt match — amount + date window. We score every receipt
  // that fits, sort by closeness, and then split into two buckets:
  // same-LLC matches win first, cross-LLC matches are surfaced as a
  // distinct kind so Lance sees the bookkeeping discrepancy instead
  // of the line silently becoming unreconciled when he reclassifies
  // a receipt's LLC.
  //
  // Only debits are eligible (receipts represent money OUT; credits
  // like refunds get reconciled differently if at all).
  if (line.amountCents < 0) {
    const targetAbs = Math.abs(line.amountCents)
    const tolerance = Math.max(200, Math.round(targetAbs * 0.02))
    const minCents = targetAbs - tolerance
    const maxCents = targetAbs + tolerance
    const dateWindow = isSlowPostMerchant(line.normalizedMerchant) ? 7 : 3

    const candidates: Array<{
      r: InputReceipt
      amountDiff: number
      dateDiff: number
      sameLlc: boolean
    }> = []
    for (const r of receipts) {
      if (r.totalCents < minCents || r.totalCents > maxCents) continue
      if (!r.purchaseDate) continue
      const dDiff = dateDiffDays(r.purchaseDate, line.postedDate)
      if (dDiff > dateWindow) continue
      candidates.push({
        r,
        amountDiff: Math.abs(r.totalCents - targetAbs),
        dateDiff: dDiff,
        sameLlc: r.llcSubcategoryId === line.llcSubcategoryId,
      })
    }
    // Best amount-distance first, ties broken by date. sameLlc is the
    // PRIMARY sort key — a clean same-LLC match outranks the closest
    // cross-LLC one, but if only cross-LLC candidates exist, the best
    // of those still surfaces (rather than the line silently becoming
    // unreconciled).
    candidates.sort((a, b) => {
      if (a.sameLlc !== b.sameLlc) return a.sameLlc ? -1 : 1
      if (a.amountDiff !== b.amountDiff) return a.amountDiff - b.amountDiff
      return a.dateDiff - b.dateDiff
    })
    const winner = candidates[0]
    if (winner) {
      if (winner.sameLlc) {
        return { kind: 'receipt_matched', receiptEntryId: winner.r.id }
      }
      return {
        kind: 'cross_llc_matched',
        receiptEntryId: winner.r.id,
        receiptLlcSubcategoryId: winner.r.llcSubcategoryId,
      }
    }
  }

  // 4. Nothing matched.
  return { kind: 'unreconciled' }
}
