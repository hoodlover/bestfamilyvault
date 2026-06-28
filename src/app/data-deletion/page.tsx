import { PublicInfoPage } from '@/components/ui/public-info-page'

export default function DataDeletionPage() {
  return (
    <PublicInfoPage
      eyebrow="Data deletion"
      title="Delete Account or Vault Data"
      intro="Instructions for removing personal data from the vault."
      updated="June 28, 2026"
      sections={[
        {
          title: 'Single user removal',
          body: (
            <p>
              A vault admin can remove or deactivate a user, revoke linked devices, and delete entries,
              notes, files, messages, and records connected to that user when appropriate.
            </p>
          ),
        },
        {
          title: 'Whole vault removal',
          body: (
            <p>
              For a full shutdown, export anything the family must keep, revoke devices, delete stored files,
              delete database rows, and remove deployment/storage resources.
            </p>
          ),
        },
        {
          title: 'Password CSV cleanup',
          body: (
            <p>
              Delete imported password CSV files from Downloads, trash/recycle bin, cloud sync folders,
              email attachments, and temporary import folders after confirming the vault import.
            </p>
          ),
        },
      ]}
    />
  )
}
