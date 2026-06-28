export type FeatureId =
  | 'profiles'
  | 'idnw'
  | 'passwords'
  | 'documents'
  | 'recipes'
  | 'money'
  | 'messages'
  | 'letters'
  | 'timeCapsules'
  | 'tasks'
  | 'receipts'
  | 'ai'

export interface FeatureMode {
  id: string
  label: string
  description: string
  features: FeatureId[]
}

export const FEATURE_MODES: FeatureMode[] = [
  {
    id: 'simple',
    label: 'Simple',
    description: 'Profile info, IDs, emergency contacts, and the end-of-life guide.',
    features: ['profiles', 'idnw', 'documents'],
  },
  {
    id: 'planning',
    label: 'Planning only',
    description: 'For someone who mainly needs profile information and the planning guide.',
    features: ['profiles', 'idnw', 'documents', 'letters'],
  },
  {
    id: 'passwords',
    label: 'Passwords',
    description: 'Password vault, imports, autofill, and linked devices.',
    features: ['profiles', 'passwords', 'documents'],
  },
  {
    id: 'family',
    label: 'Family organizer',
    description: 'Contacts, messages, documents, recipes, tasks, and daily household tools.',
    features: ['profiles', 'documents', 'recipes', 'messages', 'tasks', 'timeCapsules'],
  },
  {
    id: 'full',
    label: 'Full vault',
    description: 'Everything available for a household that wants the whole system.',
    features: ['profiles', 'idnw', 'passwords', 'documents', 'recipes', 'money', 'messages', 'letters', 'timeCapsules', 'tasks', 'receipts', 'ai'],
  },
]

export function getFeatureMode(id: string | null | undefined): FeatureMode {
  return FEATURE_MODES.find((mode) => mode.id === id) ?? FEATURE_MODES[0]
}
