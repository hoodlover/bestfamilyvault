import { PublicInfoPage } from '@/components/ui/public-info-page'

export default function PrivacyPage() {
  return (
    <PublicInfoPage
      eyebrow="Privacy"
      title="Privacy Policy"
      intro="Plain-English privacy notes for families using the vault."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Data you choose to store',
          body: (
            <p>
              The app may store names, emails, family roles, profile details, IDs, passwords,
              documents, messages, photos, notes, reminders, and planning answers when you add them.
            </p>
          ),
        },
        {
          title: 'Sensitive fields',
          body: (
            <p>
              Passwords, account numbers, SSNs, CVVs, note bodies, messages, letters, and time capsules
              are designed to be encrypted at rest. Access is still controlled by your sign-in, role,
              and item privacy settings.
            </p>
          ),
        },
        {
          title: 'Device permissions',
          body: (
            <p>
              Camera and file access are used for uploads, scans, receipts, profile photos, and document
              attachments. Notifications are used for reminders. Contacts are only used if a user connects
              contact sync.
            </p>
          ),
        },
        {
          title: 'AI features',
          body: (
            <p>
              AI helpers may process selected vault content to read cards, receipts, recipes, documents,
              or answer vault questions. Users should review AI output before relying on it.
            </p>
          ),
        },
        {
          title: 'No advertising use',
          body: (
            <p>
              Vault data is not used for advertising or sold to data brokers. The app is built for private
              family organization.
            </p>
          ),
        },
      ]}
    />
  )
}
