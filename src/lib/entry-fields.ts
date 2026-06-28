// Shared policy for which entry types surface optional fields in the UI.
// Lives in lib/ (not in a 'use client' form file) so both the client
// forms AND the server-rendered detail page can import the same gate
// without crossing the 'use client' boundary.
//
// Phone is kept ONLY on the two account-shaped types where a customer-
// service number is genuinely useful (banks, credit cards). Login and
// identity (the "password entry" and "ID card entry" in Lance's
// vocabulary) used to surface it too but most never filled it in.
// Asset / note / document entries don't render phone at all.

import type { entryTypeEnum } from './db/schema'

type EntryType = (typeof entryTypeEnum.enumValues)[number]

const PHONE_TYPES: ReadonlySet<EntryType> = new Set<EntryType>([
  'credit_card',
  'bank_account',
])

/** True when the entry type should expose a Phone field in the
 *  new/edit form AND the detail card. Asset, note, document, recipe,
 *  etc. all return false. */
export function entryTypeHasPhone(type: string | null | undefined): boolean {
  if (!type) return false
  return PHONE_TYPES.has(type as EntryType)
}
