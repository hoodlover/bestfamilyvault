// Client-safe slice of the net-worth module: types + the group catalog
// the NetWorthCard renders against. Lives apart from net-worth.ts so the
// card can import NET_WORTH_GROUP_META without dragging the `server-only`
// aggregator (and drizzle, and the db pool) into the client bundle.

export interface NetWorthSnapshot {
  /** Net total in cents — positive for net asset, negative for net debt. */
  totalCents: number
  /** Sum of asset entries (positive currentBalance). */
  assetsCents: number
  /** Sum of debt entries (negative currentBalance, returned as a positive
   *  "owed" number for display). */
  debtsCents: number
  /** Number of entries contributing to the snapshot. */
  contributingCount: number
  /** Most recent balance-as-of across contributing entries. */
  asOf: Date | null
  /** Net total 30+ days ago (looked up from balance_history). null if
   *  we don't have 30-day-old history yet. */
  prevTotalCents: number | null
  /** Every contributing entry, sorted by absolute balance descending.
   *  The card slices this for its default top-N view and exposes the
   *  full list behind a "View all" toggle. */
  items: NetWorthItem[]
}

export interface NetWorthItem {
  entryId: string
  title: string
  type: string
  /** Coarse bucket the NetWorthCard groups + toggles on. Derived from
   *  (type, accountType) — Banks split into Checking/Savings/IRA/etc.,
   *  Cards roll up under Credit, Assets split into Houses/Cars/Other. */
  group: NetWorthGroup
  balanceCents: number
  asOf: Date | null
}

export type NetWorthGroup =
  | 'checking'
  | 'savings'
  | 'ira'
  | 'investment'
  | 'bank_other'
  | 'credit'
  | 'house'
  | 'car'
  | 'asset_other'

export const NET_WORTH_GROUP_META: Record<NetWorthGroup, { label: string; emoji: string; order: number }> = {
  checking:    { label: 'Checking',    emoji: '💳', order: 1 },
  savings:     { label: 'Savings',     emoji: '🐖', order: 2 },
  ira:         { label: 'IRA / 401k',  emoji: '🪺', order: 3 },
  investment:  { label: 'Investment',  emoji: '📈', order: 4 },
  bank_other:  { label: 'Other Bank',  emoji: '🏦', order: 5 },
  credit:      { label: 'Credit',      emoji: '💸', order: 6 },
  house:       { label: 'Houses',      emoji: '🏠', order: 7 },
  car:         { label: 'Cars',        emoji: '🚗', order: 8 },
  asset_other: { label: 'Other Assets', emoji: '💎', order: 9 },
}

export function classifyGroup(type: string, accountType: string | null): NetWorthGroup {
  const at = (accountType ?? '').toLowerCase()
  if (type === 'credit_card') return 'credit'
  if (type === 'asset') {
    if (at.includes('house') || at.includes('home') || at.includes('property') || at.includes('real')) return 'house'
    if (at.includes('car') || at.includes('truck') || at.includes('auto') || at.includes('vehicle') || at.includes('boat')) return 'car'
    return 'asset_other'
  }
  // bank_account fallthrough
  if (at.includes('check')) return 'checking'
  if (at.includes('saving')) return 'savings'
  if (at.includes('ira') || at.includes('401') || at.includes('roth') || at.includes('retire')) return 'ira'
  if (at.includes('invest') || at.includes('brokerage') || at.includes('fidelity') || at.includes('vanguard')) return 'investment'
  return 'bank_other'
}
