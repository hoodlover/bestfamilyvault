import { PROPERTIES } from './family-config'

export const COBB_ICON_BASE = '/icons/cobb'

// Build the home/our-places subcategory shortLabel map from PROPERTIES so a
// fork doesn't have to grep through this file to rename the family
// properties — they edit family-config.ts and the labels follow.
const PROPERTY_LABELS: Record<string, string> = Object.fromEntries(
  PROPERTIES.map((p) => [p.storageKey, p.shortLabel]),
)

export const categoryPresentation: Record<string, { label?: string; icon: string }> = {
  // Live categories — slug → label override + cobb icon
  finance: { label: 'Finances', icon: `${COBB_ICON_BASE}/finances.png` },
  home: { label: 'Our Places', icon: `${COBB_ICON_BASE}/cabin.png` },
  kids: { label: 'Family', icon: `${COBB_ICON_BASE}/family.png` },
  health: { icon: `${COBB_ICON_BASE}/health.png` },
  auto: { icon: `${COBB_ICON_BASE}/icons/system/dog_truck_road.png` },
  business: { label: 'How Tos', icon: `${COBB_ICON_BASE}/howto.png` },
  travel: { label: 'Travel & Fun', icon: `${COBB_ICON_BASE}/travel.png` },
  entertainment: { label: 'Tech', icon: `${COBB_ICON_BASE}/icons/tech/connected_devices.png` },

  // Aliases / legacy slugs that may show up in queries
  finances: { icon: `${COBB_ICON_BASE}/finances.png` },
  documents: { icon: `${COBB_ICON_BASE}/documents.png` },
  family: { icon: `${COBB_ICON_BASE}/family.png` },
  notes: { icon: `${COBB_ICON_BASE}/notes.png` },
  passwords: { icon: `${COBB_ICON_BASE}/passwords.png` },
  pets: { icon: `${COBB_ICON_BASE}/pets.png` },
  properties: { label: 'Our Places', icon: `${COBB_ICON_BASE}/cabin.png` },
  'our-places': { label: 'Our Places', icon: `${COBB_ICON_BASE}/cabin.png` },
  shopping: { icon: `${COBB_ICON_BASE}/shopping.png` },
  tech: { icon: `${COBB_ICON_BASE}/icons/tech/connected_devices.png` },
}

export function getCategoryIcon(slug: string, fallback?: string | null) {
  // Whatever's set on the DB row (Lance's icon-picker choice) wins over the
  // hardcoded preset map. The preset is only a default for categories that
  // have never had an icon assigned. Without this priority, picks against
  // the seeded categories silently no-op'd in the UI even though the DB
  // updated correctly.
  return fallback ?? categoryPresentation[slug]?.icon ?? `${COBB_ICON_BASE}/privatevault.png`
}

export function getCategoryLabel(slug: string, name: string) {
  return categoryPresentation[slug]?.label ?? name
}

const subcategoryLabels: Record<string, Record<string, string>> = {
  finance: {
    'checking & saving banks': 'Banking',
    'credit cards': 'Cards',
    investments: 'Invest',
    'loans & mortgages': 'Loans',
    subscriptions: 'Bills',
  },
  home: {
    airbnb: 'Airbnb',
    ...PROPERTY_LABELS,
    'smart home apps': 'Smart Home',
  },
  kids: {
    'id documents': 'IDs',
  },
  health: {
    prescriptions: 'Rx',
  },
  auto: {
    registration: 'Tags',
    maintenance: 'Service',
    financing: 'Loans',
    'car rentals': 'Rentals',
  },
  business: {
    'end of the world': 'EOTW',
    "i'm gone": 'IDNW',
  },
  travel: {
    'car rentals': 'Rentals',
    'passports & visas': 'Passports',
  },
  entertainment: {
    memberships: 'Plans',
    'ai tools': 'AI',
  },
  'end-of-the-world': {
    checklists: 'Lists',
    'family docs': 'Docs',
    'food & water': 'Food/Water',
    'red folder': 'Red File',
    'shtf info': 'SHTF',
    'solar & power': 'Power',
    'stores if food': 'Stores',
  },
  legal: {
    'healthcare directives': 'Directives',
    'powers of attorney': 'POA',
    'beneficiary forms': 'Beneficiary',
    'estate planning': 'Estate',
    'other legal': 'Other',
  },
}

export function getSubcategoryLabel(categorySlug: string, name: string) {
  return subcategoryLabels[categorySlug]?.[name.trim().toLowerCase()] ?? name
}


const subcategoryIconRules: Array<{ test: RegExp; icon: string }> = [
  { test: /checking|savings|bank|loan|mortgage|tax|investment|finance/i, icon: `${COBB_ICON_BASE}/finances.png` },
  { test: /credit|card|shopping|receipt/i, icon: `${COBB_ICON_BASE}/shopping.png` },
  { test: /utility|utilities|appliance|hoa|cabin|forest|continental|place|property|home/i, icon: `${COBB_ICON_BASE}/cab-close.png` },
  { test: /insurance|legal|document|id|passport|receipt/i, icon: `${COBB_ICON_BASE}/documents.png` },
  { test: /doctor|medical|prescription|dental|vision|health/i, icon: `${COBB_ICON_BASE}/health.png` },
  { test: /school|activity|family|kid|parent/i, icon: `${COBB_ICON_BASE}/family.png` },
  { test: /airline|hotel|rental|travel|visa/i, icon: `${COBB_ICON_BASE}/travel.png` },
  { test: /stream|device|gaming|music|tech|membership/i, icon: `${COBB_ICON_BASE}/tech.png` },
  { test: /security|private|password/i, icon: `${COBB_ICON_BASE}/privatevault.png` },
  { test: /auto|registration|maintenance|vehicle/i, icon: `${COBB_ICON_BASE}/mav-river-icon.png` },
]

export function getSubcategoryIcon(categorySlug: string, name: string, fallback?: string | null) {
  // Same priority as categories: the DB value wins. Used to require a
  // leading slash to accept the fallback, which excluded blob URLs (https://…)
  // from the upload flow.
  if (fallback) return fallback
  const rule = subcategoryIconRules.find((item) => item.test.test(name))
  return rule?.icon ?? getCategoryIcon(categorySlug)
}
