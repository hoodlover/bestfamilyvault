export interface FamilyPresetMember {
  label: string
  role: string
  ageGroup: 'adult' | 'child' | 'elder' | 'helper'
  suggestedAccess: 'superuser' | 'admin' | 'member' | 'readonly'
}

export interface FamilyPreset {
  id: string
  label: string
  description: string
  members: FamilyPresetMember[]
}

export const FAMILY_PRESETS: FamilyPreset[] = [
  {
    id: 'family-four',
    label: 'Family of four',
    description: 'Two adults, one boy, one girl. Good default for a young household.',
    members: [
      { label: 'Adult 1', role: 'Parent', ageGroup: 'adult', suggestedAccess: 'superuser' },
      { label: 'Adult 2', role: 'Parent', ageGroup: 'adult', suggestedAccess: 'admin' },
      { label: 'Boy', role: 'Son', ageGroup: 'child', suggestedAccess: 'member' },
      { label: 'Girl', role: 'Daughter', ageGroup: 'child', suggestedAccess: 'member' },
    ],
  },
  {
    id: 'blended',
    label: 'Blended family',
    description: 'Step mom, step dad, multiple kids, plus flexible parent roles.',
    members: [
      { label: 'Adult 1', role: 'Step parent', ageGroup: 'adult', suggestedAccess: 'superuser' },
      { label: 'Adult 2', role: 'Step parent', ageGroup: 'adult', suggestedAccess: 'admin' },
      { label: 'Child 1', role: 'Child', ageGroup: 'child', suggestedAccess: 'member' },
      { label: 'Child 2', role: 'Child', ageGroup: 'child', suggestedAccess: 'member' },
      { label: 'Child 3', role: 'Child', ageGroup: 'child', suggestedAccess: 'member' },
    ],
  },
  {
    id: 'grandparents',
    label: 'Grandparents',
    description: 'Grandma, grandpa, adult child helper, and optional grandkids.',
    members: [
      { label: 'Grandma', role: 'Grandparent', ageGroup: 'elder', suggestedAccess: 'superuser' },
      { label: 'Grandpa', role: 'Grandparent', ageGroup: 'elder', suggestedAccess: 'admin' },
      { label: 'Adult child', role: 'Trusted helper', ageGroup: 'helper', suggestedAccess: 'admin' },
      { label: 'Grandchild', role: 'Family member', ageGroup: 'child', suggestedAccess: 'readonly' },
    ],
  },
  {
    id: 'elder-simple',
    label: 'Elder simple',
    description: 'One older adult and one trusted helper. Keeps the app small.',
    members: [
      { label: 'Owner', role: 'Owner', ageGroup: 'elder', suggestedAccess: 'superuser' },
      { label: 'Trusted helper', role: 'Helper', ageGroup: 'helper', suggestedAccess: 'admin' },
    ],
  },
  {
    id: 'full-household',
    label: 'Full household',
    description: 'Parents, kids, grandparents, and a trusted outside contact.',
    members: [
      { label: 'Owner', role: 'Parent', ageGroup: 'adult', suggestedAccess: 'superuser' },
      { label: 'Partner', role: 'Parent', ageGroup: 'adult', suggestedAccess: 'admin' },
      { label: 'Child 1', role: 'Child', ageGroup: 'child', suggestedAccess: 'member' },
      { label: 'Child 2', role: 'Child', ageGroup: 'child', suggestedAccess: 'member' },
      { label: 'Grandma', role: 'Grandparent', ageGroup: 'elder', suggestedAccess: 'readonly' },
      { label: 'Grandpa', role: 'Grandparent', ageGroup: 'elder', suggestedAccess: 'readonly' },
      { label: 'Trusted contact', role: 'Helper', ageGroup: 'helper', suggestedAccess: 'readonly' },
    ],
  },
]

export function getFamilyPreset(id: string | null | undefined): FamilyPreset {
  return FAMILY_PRESETS.find((preset) => preset.id === id) ?? FAMILY_PRESETS[0]
}
