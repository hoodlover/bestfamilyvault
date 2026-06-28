import { PublicInfoPage } from '@/components/ui/public-info-page'
import { APP_NAME } from '@/lib/branding'

export default function AboutPage() {
  return (
    <PublicInfoPage
      eyebrow="About"
      title={APP_NAME}
      intro="A private family vault for the practical details people need but rarely keep in one calm place."
      updated="June 28, 2026"
      sections={[
        {
          title: 'What the app does',
          body: (
            <p>
              The vault stores family profiles, IDs, passwords, documents, notes, recurring bills,
              contacts, messages, family letters, time capsules, and an end-of-life planning guide.
              Families can turn off sections they do not need.
            </p>
          ),
        },
        {
          title: 'Who it is for',
          body: (
            <p>
              It can support a full household, a blended family, grandparents, or one person who only
              wants emergency profile information and the planning guide.
            </p>
          ),
        },
        {
          title: 'Not a public social app',
          body: (
            <p>
              This is a private utility. It has no public profiles, public posting, ads, or social feed.
            </p>
          ),
        },
      ]}
    />
  )
}
