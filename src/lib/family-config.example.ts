// Template for forking families. Copy this file over `family-config.ts`
// and edit the values for your own family. The existing `family-config.ts`
// holds this project's actual values; replace it.
//
// ┌───────────────────────────────────────────────────────────────────┐
// │ Quick start                                                       │
// │   1. cp src/lib/family-config.example.ts src/lib/family-config.ts │
// │   2. edit src/lib/family-config.ts: set OWNER, MEMBERS, etc.      │
// │   3. swap the photos under public/icons/cobb/ for your own        │
// │      (see folderImg paths in MEMBERS — replace those PNGs)        │
// │   4. npm run dev — verify your names render correctly             │
// └───────────────────────────────────────────────────────────────────┘

import type {
  FamilyOwner,
  FamilyMember,
  FamilyProperty,
  LegacyGuide,
  FormSuggestions,
} from './family-config'

// ─── Owner: the primary user / superuser of the vault ──────────────────────

export const OWNER: FamilyOwner = {
  // First name shown across the UI ("Family Letters", "For X only" admin
  // sections, etc.). Use whichever name your family actually calls you.
  name: 'Owner',

  // Family role label used in copy ("Dad", "Mom", "Parent", "Aunt").
  role: 'Parent',

  // Every email this person uses. Used for owner-detection in admin gates,
  // the "I'm dead, now what?" guide ownership, etc. List ALL of them — work
  // email, personal email, alt addresses — so you don't get locked out of
  // owner-only features when you happen to be signed in via a secondary one.
  // The first entry is the canonical address used in template copy.
  emails: [
    'owner@example.com',
    // 'owner@work.example.com',
    // 'owner@alt.example.com',
  ],
}

// ─── Members: everyone in the family ───────────────────────────────────────
//
// One entry per family member. Set `letterRecipient: true` for anyone who
// should appear on the "Family Letters" page — the owner usually leaves
// themselves out and includes their partner + kids.
//
// `folderImg` is the photo shown on the recipient's letter card. Drop a
// portrait PNG at the path you list (suggested: 800×1200 vertical photo).

export const MEMBERS: FamilyMember[] = [
  // Example: a partner
  // { slug: 'partner', display: 'Partner', role: 'Spouse',  letterRecipient: true, folderImg: '/icons/cobb/partner-letters.png' },

  // Example: a kid
  // { slug: 'firstkid', display: 'First Kid', role: 'Son', letterRecipient: true, folderImg: '/icons/cobb/firstkid-letters.png' },
]

// ─── Properties: named places you reference in entries ─────────────────────
//
// Most families have nicknames for the houses / cabins / rentals they
// store records about ("the Lake House", "Mom's place", "10 Oak Drive").
// List them here and they show up as subcategory tabs on the home category.
//
// `storageKey` MUST match exactly what's stored in the DB subcategory NAME
// field. If you're starting fresh, pick whatever you want here — when you
// add property entries, set the subcategory to the same string.
//
// `shortLabel` is the abbreviated tab label (≤12 chars looks best).
// `displayName` is the full version used in modal headers.

export const PROPERTIES: FamilyProperty[] = [
  // { storageKey: 'lake house',   shortLabel: 'Lake',   displayName: 'Lake House'    },
  // { storageKey: 'main house',   shortLabel: 'Main',   displayName: 'Main House'    },
  // { storageKey: 'rental 123 oak', shortLabel: '123 Oak', displayName: 'Rental — 123 Oak' },
]

// ─── Legacy guides: the "I'm Dead, Now What?" pages ────────────────────────
//
// One guide per person whose family needs to know what to do if that person
// dies. The first guide in the list is the default at `/now-what`; the rest
// live at `/now-what/<slug-suffix>`.
//
// Most families: ONE guide for the primary household financial owner, ONE
// for the partner.

export const LEGACY_GUIDES: LegacyGuide[] = [
  // {
  //   key:        'owner',
  //   slug:       'now-what',
  //   ownerName:  'Owner',
  //   familyRole: 'Dad',
  //   route:      '/now-what',
  // },
  // {
  //   key:        'partner',
  //   slug:       'now-what-partner',
  //   ownerName:  'Partner',
  //   familyRole: 'Mom',
  //   route:      '/now-what/partner',
  // },
]

// ─── Form suggestions: autocomplete pre-fills on new entries ──────────────
//
// Each list pre-populates the matching combo-box on the New Entry form.
// First tap shows the list; second tap lets you free-type. All start
// empty in the starter — fill them in over time as you find yourself
// re-typing the same names / emails / banks.
//
// SECURITY: passwordHints is sensitive — never push real password
// fragments to a public repo. Leave empty unless you're self-hosting
// and the repo is private.

export const FORM_SUGGESTIONS: FormSuggestions = {
  cardholderNames: [],
  emails: [],
  passwordHints: [],
  bankNames: [],
}


// ─── Don't touch: derived helpers that read from the values above ──────────

export const LETTER_RECIPIENTS = MEMBERS.filter((m) => m.letterRecipient)

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase().trim()
  return OWNER.emails.some((o) => o.toLowerCase() === e)
}

export function getMember(slug: string): FamilyMember | null {
  return MEMBERS.find((m) => m.slug === slug) ?? null
}

export function getLegacyGuide(key: string): LegacyGuide | null {
  return LEGACY_GUIDES.find((g) => g.key === key) ?? null
}
