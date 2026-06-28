// Single source of truth for Family Letters recipient slots.
//
// Letters are addressed by `slug` (lowercase first-name) rather than a user FK
// because some recipients haven't signed up yet — letters need to be
// addressable today and become visible to those users automatically when they
// log in (first-name match against `users.name`).
//
// The recipient list is derived from `MEMBERS` in `family-config.ts`. To add
// or remove a recipient, edit that file — not this one.

import { LETTER_RECIPIENTS as CONFIG_RECIPIENTS } from './family-config'

export type LetterRecipient = {
  slug: string
  display: string
  folderImg: string
}

export const LETTER_RECIPIENTS: readonly LetterRecipient[] = CONFIG_RECIPIENTS.map((m) => ({
  slug: m.slug,
  display: m.display,
  folderImg: m.folderImg,
}))

export const LETTER_RECIPIENT_SLUGS = LETTER_RECIPIENTS.map((r) => r.slug)

export function isAllowedRecipientSlug(slug: string): boolean {
  return (LETTER_RECIPIENT_SLUGS as string[]).includes(slug)
}

/**
 * Derive a recipient slug from a user's display name. Used to decide which
 * cards a non-superuser is allowed to read on the /letters page.
 * Returns null when the user has no name set.
 */
export function recipientSlugForUserName(name: string | null | undefined): string | null {
  if (!name) return null
  const first = name.trim().split(/\s+/)[0]?.toLowerCase()
  return first && isAllowedRecipientSlug(first) ? first : null
}
