import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { categories } from '@/lib/db/schema'
import { HelpPopout } from '@/components/ui/help-popout'
import { Upload } from 'lucide-react'
import { ImportPageTabs } from '@/components/ui/import-page-tabs'
import { VaultInboxSyncPanel } from '@/components/ui/vault-inbox-sync-panel'
import { RecentlyImportedSection } from '@/components/ui/recently-imported-section'
import { isVaultInboxAvailable } from '@/lib/vault-inbox-path'

export default async function ImportPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role === 'readonly') redirect('/dashboard')

  const allCategories = await db.select().from(categories).orderBy(categories.sortOrder)
  // Only the local Windows machine with the drop folder can run the sync;
  // the deployed server can't reach it, so the button is disabled there.
  const syncAvailable = isVaultInboxAvailable()

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
          <Upload size={20} className="text-emerald-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-stone-100">Bulk Import</h1>
            <HelpPopout
              title="Bulk Import"
              sections={[
                {
                  heading: 'Formats',
                  tips: [
                    { title: 'CSV', description: 'Standard CSV with a header row. Column → field mapping happens on the next step.' },
                    { title: 'Plain text', description: 'One entry per line for simple imports (e.g. a list of website names to seed).' },
                    { title: 'Sticky Password XML', description: 'Use the import:sticky CLI script for legacy Sticky exports.' },
                  ],
                },
                {
                  heading: 'Flow',
                  tips: [
                    { title: 'Preview', description: 'After upload you see a parsed preview — confirm field mapping before committing.' },
                    { title: 'Categorize automatically', description: 'Claude can suggest a category + subcategory per row based on title. Look for the suggest button on each row.' },
                    { title: 'Re-runnable', description: 'Imports are tagged so you can re-import + dedupe by source ID without creating duplicates.' },
                  ],
                },
              ]}
            />
          </div>
          <p className="text-sm text-stone-400 mt-0.5">Import entries or notes from CSV or text files.</p>
        </div>
      </div>

      <VaultInboxSyncPanel available={syncAvailable} />
      <RecentlyImportedSection userId={session.user.id} />
      <ImportPageTabs categories={allCategories} />
    </div>
  )
}
