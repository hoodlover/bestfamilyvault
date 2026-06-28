// Single source of truth for "who is this vault for."
//
// This starter file intentionally contains no real family names, emails,
// password hints, properties, or inside jokes. Edit these values as the new
// household takes shape.

export interface FamilyOwner {
  name: string
  role: string
  emails: string[]
  aliases?: string[]
}

export interface FamilyMember {
  slug: string
  display: string
  role: string
  letterRecipient: boolean
  folderImg: string
  emails?: string[]
  isParent?: boolean
}

export interface FamilyProperty {
  storageKey: string
  shortLabel: string
  displayName: string
}

export interface LegacyGuide {
  key: string
  slug: string
  ownerName: string
  familyRole: string
  route: string
}

export interface FormSuggestions {
  cardholderNames: string[]
  emails: string[]
  passwordHints: string[]
  bankNames: string[]
}


export const OWNER: FamilyOwner = {
  name: 'Owner',
  role: 'Parent',
  emails: ['owner@example.com'],
  aliases: [],
}

export const MEMBERS: FamilyMember[] = []

export const PROPERTIES: FamilyProperty[] = []

export const LEGACY_GUIDES: LegacyGuide[] = [
  { key: 'owner', slug: 'now-what', ownerName: 'Owner', familyRole: 'Parent', route: '/now-what' },
]

export const FORM_SUGGESTIONS: FormSuggestions = {
  cardholderNames: [],
  emails: [],
  passwordHints: [],
  bankNames: [],
}

export const LETTER_RECIPIENTS = MEMBERS.filter((m) => m.letterRecipient)

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase().trim()
  return OWNER.emails.some((o) => o.toLowerCase() === e)
}

export function getMember(slug: string): FamilyMember | null {
  return MEMBERS.find((m) => m.slug === slug) ?? null
}

export function getParentRecipients(): { slug: string; display: string; emails: string[] }[] {
  const out: { slug: string; display: string; emails: string[] }[] = [
    { slug: OWNER.name.toLowerCase(), display: OWNER.name, emails: OWNER.emails },
  ]
  for (const m of MEMBERS) {
    if (!m.isParent) continue
    if (out.some((p) => p.slug === m.slug)) continue
    out.push({ slug: m.slug, display: m.display, emails: m.emails ?? [] })
  }
  return out
}

export function getLegacyGuide(key: string): LegacyGuide | null {
  return LEGACY_GUIDES.find((g) => g.key === key) ?? null
}
