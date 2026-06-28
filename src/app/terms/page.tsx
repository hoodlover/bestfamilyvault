import { PublicInfoPage } from '@/components/ui/public-info-page'

export default function TermsPage() {
  return (
    <PublicInfoPage
      eyebrow="Terms"
      title="Terms of Use"
      intro="Use the vault as a private organizer, not as a substitute for professional advice."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Your responsibility',
          body: <p>You are responsible for what you add, who you invite, and which people receive access.</p>,
        },
        {
          title: 'No professional advice',
          body: (
            <p>
              Planning prompts, financial summaries, medical details, and legal checklists are organization
              tools only. They are not legal, financial, tax, medical, or estate-planning advice.
            </p>
          ),
        },
        {
          title: 'Exports and password files',
          body: (
            <p>
              Imported CSV password files are extremely sensitive. Keep them local, import only on a trusted
              device, and delete the export after confirming the import.
            </p>
          ),
        },
      ]}
    />
  )
}
