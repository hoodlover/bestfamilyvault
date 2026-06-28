import { PublicInfoPage } from '@/components/ui/public-info-page'
import { FAMILY_PRESETS } from '@/lib/family-presets'
import { FEATURE_MODES } from '@/lib/feature-modes'

export default function WelcomePage() {
  return (
    <PublicInfoPage
      eyebrow="Welcome"
      title="Getting Started"
      intro="A short first-run path for families who are opening the vault for the first time."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Step 1: Name the household',
          body: <p>Add the vault owner, partner or co-parent, kids, grandparents, and any trusted helpers.</p>,
        },
        {
          title: 'Step 2: Pick a mode',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              {FEATURE_MODES.map((mode) => (
                <li key={mode.id}><strong>{mode.label}:</strong> {mode.description}</li>
              ))}
            </ul>
          ),
        },
        {
          title: 'Starter family presets',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              {FAMILY_PRESETS.map((preset) => (
                <li key={preset.id}><strong>{preset.label}:</strong> {preset.description}</li>
              ))}
            </ul>
          ),
        },
        {
          title: 'Step 3: Add one real thing',
          body: <p>Start with one profile card, one ID, one password, or one planning answer.</p>,
        },
        {
          title: 'Step 4: Import carefully',
          body: <p>If passwords live elsewhere, read the import guide before exporting any CSV file.</p>,
        },
      ]}
    />
  )
}
