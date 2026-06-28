import Link from 'next/link'
import { PublicInfoPage } from '@/components/ui/public-info-page'

export default function SupportPage() {
  return (
    <PublicInfoPage
      eyebrow="Support"
      title="Help and Support"
      intro="Where users should start when they need help, account changes, or data removal."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Common help paths',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>Use the in-app guide after signing in.</li>
              <li>Use Settings to install the app, manage linked devices, and request access changes.</li>
              <li>Use the password import guide before exporting a CSV from another password manager.</li>
            </ul>
          ),
        },
        {
          title: 'Account and data deletion',
          body: (
            <p>
              Review <Link href="/data-deletion" className="text-emerald-300 hover:text-emerald-200">data deletion instructions</Link>
              {' '}before removing an account or family vault.
            </p>
          ),
        },
      ]}
    />
  )
}
