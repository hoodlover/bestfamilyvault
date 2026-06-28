// Configuration and types for the "I'm Dead, Now What?" guide. Lives
// outside the 'use server' action file because Next.js requires
// server-action files to export only async functions — TOPIC_ORDER and
// SECTION_ORDER are arrays, so they sit here and the action file imports
// them along with anything in /now-what/page.tsx that needs to render
// section ordering.
//
// Per-person guide profiles are derived from `LEGACY_GUIDES` in
// `family-config.ts` — edit that file to add or rename guide owners.

import { LEGACY_GUIDES } from './family-config'

export const GUIDE_SLUG = LEGACY_GUIDES[0]?.slug ?? 'now-what'
export const GUIDE_NAME = "I'm Dead, Now What?"
export const LETTER_TAG = 'now-what:letter'

// Legacy export name kept so older imports keep working — points at the
// SECOND guide in the config (typically the partner) when one exists.
export const HEATHER_GUIDE_SLUG = LEGACY_GUIDES[1]?.slug ?? 'now-what-heather'
export const HEATHER_GUIDE_NAME = LEGACY_GUIDES[1]
  ? `${LEGACY_GUIDES[1].ownerName}'s I'm Dead, Now What?`
  : "Partner's I'm Dead, Now What?"

export interface GuideProfile {
  /** Stable identifier — typically the owner's lowercase first name. */
  key: string
  slug: string
  name: string
  ownerName: string
  familyRole: string
  route: string
}

export const GUIDE_PROFILES: GuideProfile[] = LEGACY_GUIDES.map((g) => ({
  key:        g.key,
  slug:       g.slug,
  name:       g.key === LEGACY_GUIDES[0]?.key
                ? GUIDE_NAME
                : `${g.ownerName}'s I'm Dead, Now What?`,
  ownerName:  g.ownerName,
  familyRole: g.familyRole,
  route:      g.route,
}))

// First guide in config is the "primary" one — its route /now-what is
// the default path; admin link blocks are also gated on this profile's
// owner. Sibling guides only show up when navigated to directly.
export const VISIBLE_GUIDE_PROFILES = GUIDE_PROFILES.slice(0, 1)

export function getGuideProfile(key: string): GuideProfile {
  return GUIDE_PROFILES.find((profile) => profile.key === key) ?? GUIDE_PROFILES[0]
}

export function guideRouteForSlug(slug: string): string | null {
  return GUIDE_PROFILES.find((profile) => profile.slug === slug)?.route ?? null
}

export function isGuideSlug(slug: string): boolean {
  return GUIDE_PROFILES.some((profile) => profile.slug === slug)
}

export interface TopicDef {
  tag: string
  defaultTitle: string
  section: string
  /** True when this topic's answer goes stale yearly (taxes, account
   *  summaries, insurance renewals, etc.) so the dashboard prompts a
   *  revisit anything edited > 12 months ago. Defaults to false; bias
   *  toward setting it on financial / health / insurance / tax topics. */
  needsYearlyReview?: boolean
}

/** Notes / entries are stale when `updatedAt` is older than this. Uses
 *  a "yearly or so" cadence — a year + a
 *  small slack so a December-touched topic still reads as fresh in early
 *  January of the next year. */
export const YEARLY_STALE_MS = 380 * 24 * 60 * 60 * 1000

/** Display order for the topic grid — drives both the seed ordering and
 *  how the index page sorts loaded notes. The `section` field groups
 *  cards under a quiet header on the index page. Tags are stable
 *  identifiers so re-running the seed only inserts what's missing
 *  without disturbing anything already edited. */
export const TOPIC_ORDER: TopicDef[] = [
  // ─── Start here ──────────────────────────────────────────────────────
  { tag: 'now-what:first-48', section: 'Start here', defaultTitle: 'First 48 hours' },
  { tag: 'now-what:people', section: 'Start here', defaultTitle: 'People to call' },
  { tag: 'now-what:local-help', section: 'Start here', defaultTitle: 'Local agencies & services' },

  // ─── Personal / life story ───────────────────────────────────────────
  { tag: 'now-what:biographical', section: 'Personal', defaultTitle: 'Biographical information' },
  { tag: 'now-what:education', section: 'Personal', defaultTitle: 'Education' },
  { tag: 'now-what:employment', section: 'Personal', defaultTitle: 'Employment history' },
  { tag: 'now-what:marriage', section: 'Personal', defaultTitle: 'Marriage, separation, divorce' },

  // ─── Identity & legal ────────────────────────────────────────────────
  { tag: 'now-what:identification', section: 'Identity & legal', defaultTitle: 'Identification (SSN, DL, passport)' },
  { tag: 'now-what:will', section: 'Identity & legal', defaultTitle: 'Last will & testament' },
  { tag: 'now-what:poa-finance', section: 'Identity & legal', defaultTitle: 'Power of attorney — finances' },
  { tag: 'now-what:poa-health', section: 'Identity & legal', defaultTitle: 'Healthcare directives & living will' },

  // ─── Money ───────────────────────────────────────────────────────────
  // Money topics shift constantly — balances, account lists, beneficiaries,
  // and tax filings all change yearly. Flag for the dashboard nag.
  { tag: 'now-what:money-summary', section: 'Money', defaultTitle: 'Summary of accounts', needsYearlyReview: true },
  { tag: 'now-what:bank-accounts', section: 'Money', defaultTitle: 'Bank accounts', needsYearlyReview: true },
  { tag: 'now-what:brokerage', section: 'Money', defaultTitle: 'Brokerage & bonds', needsYearlyReview: true },
  { tag: 'now-what:credit-cards', section: 'Money', defaultTitle: 'Credit cards & debts', needsYearlyReview: true },
  { tag: 'now-what:retirement', section: 'Money', defaultTitle: 'Retirement, IRA, gov benefits', needsYearlyReview: true },
  { tag: 'now-what:life-insurance', section: 'Money', defaultTitle: 'Life insurance', needsYearlyReview: true },
  { tag: 'now-what:subscriptions', section: 'Money', defaultTitle: 'Memberships & subscriptions', needsYearlyReview: true },
  { tag: 'now-what:taxes', section: 'Money', defaultTitle: 'Taxes', needsYearlyReview: true },

  // ─── Property ────────────────────────────────────────────────────────
  // House notes drift when there's a refi / new insurance / vehicle swap;
  // the active ones get flagged. Static items (Firearms, valuables roster)
  // change less often and stay unflagged.
  { tag: 'now-what:forest', section: 'Property', defaultTitle: 'Forest house', needsYearlyReview: true },
  { tag: 'now-what:continental', section: 'Property', defaultTitle: 'Continental house', needsYearlyReview: true },
  { tag: 'now-what:weeks-creek', section: 'Property', defaultTitle: 'Weeks Creek house', needsYearlyReview: true },
  { tag: 'now-what:previous-residences', section: 'Property', defaultTitle: 'Previous residences' },
  { tag: 'now-what:vehicles', section: 'Property', defaultTitle: 'Vehicles', needsYearlyReview: true },
  { tag: 'now-what:home-inventory', section: 'Property', defaultTitle: 'Home inventory & valuables' },
  { tag: 'now-what:firearms', section: 'Property', defaultTitle: 'Firearms' },

  // ─── Health & end of life ────────────────────────────────────────────
  // Healthcare/insurance churns every open-enrollment cycle. End-of-life
  // wishes and burial preferences are durable; leave them unflagged.
  { tag: 'now-what:healthcare', section: 'Health & end of life', defaultTitle: 'Healthcare & insurance', needsYearlyReview: true },
  { tag: 'now-what:organ-donation', section: 'Health & end of life', defaultTitle: 'Organ / body donation' },
  { tag: 'now-what:end-of-life', section: 'Health & end of life', defaultTitle: 'End of life wishes' },
  { tag: 'now-what:burial', section: 'Health & end of life', defaultTitle: 'Burial or cremation' },
  { tag: 'now-what:funeral', section: 'Health & end of life', defaultTitle: 'Funeral & memorial' },
  { tag: 'now-what:obituary', section: 'Health & end of life', defaultTitle: 'Obituary' },

  // ─── Pets ────────────────────────────────────────────────────────────
  { tag: 'now-what:pets', section: 'Pets', defaultTitle: 'Pets & livestock' },

  // ─── Digital ─────────────────────────────────────────────────────────
  { tag: 'now-what:digital', section: 'Digital', defaultTitle: 'Digital life' },
  { tag: 'now-what:passwords', section: 'Digital', defaultTitle: 'Vault & secured passwords' },
  { tag: 'now-what:personal-property', section: 'Digital', defaultTitle: 'Personal property & digital assets' },

  // ─── Misc ────────────────────────────────────────────────────────────
  { tag: 'now-what:network', section: 'Misc', defaultTitle: 'Home network specs' },
  { tag: 'now-what:alexa', section: 'Misc', defaultTitle: 'Alexa commands' },
  { tag: 'now-what:utilities-general', section: 'Misc', defaultTitle: 'Service providers & utilities' },
]

// Display order for the section headers themselves, so the index page
// renders them in a stable order regardless of what comes back from the
// DB. Anything not listed here falls through to "Other" at the bottom.
export const SECTION_ORDER = [
  'Start here',
  'Personal',
  'Identity & legal',
  'Money',
  'Property',
  'Health & end of life',
  'Pets',
  'Digital',
  'Misc',
  'Other',
]

export interface GuideNoteRow {
  id: string
  title: string
  content: string
  tags: string[]
  updatedAt: Date
  /** Section header to render this card under, derived from TOPIC_ORDER. */
  section: string
}

/** True when a topic is marked yearly-review AND its underlying note was
 *  last touched outside the freshness window. The caller passes the
 *  matched tag from the row's tags array (or the topic's tag directly).
 *
 *  Use both arguments so the staleness check doesn't have to repeat the
 *  TOPIC_ORDER lookup at every call site. */
export function isTopicStale(tag: string, updatedAt: Date | null | undefined, nowMs = Date.now()): boolean {
  const def = TOPIC_ORDER.find((t) => t.tag === tag)
  if (!def?.needsYearlyReview) return false
  if (!updatedAt) return true
  return nowMs - updatedAt.getTime() > YEARLY_STALE_MS
}

/** Set of tags that carry the yearly-review flag — handy for client
 *  components that just need to know "should this row show the YEARLY
 *  pill" without recomputing from TOPIC_ORDER. */
export const YEARLY_REVIEW_TAGS = new Set(
  TOPIC_ORDER.filter((t) => t.needsYearlyReview).map((t) => t.tag),
)
