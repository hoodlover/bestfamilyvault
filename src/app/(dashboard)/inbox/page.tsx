import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { InboxClient } from './inbox-client'
import { HelpPopout } from '@/components/ui/help-popout'

// Android-share inbox. Files land here when Lance shares from his
// phone's Share menu and picks Family Vault as the destination — the
// share-target route handler at /inbox/share writes the row, and this
// page surfaces it for sorting (attach to an entry, attach to a note,
// or delete).
//
// Scope note: this is deliberately Android-share-only. Desktop file
// dropping goes through the existing local Windows Vault File Drop +
// import-inbox.ts smart router under /import — we don't duplicate
// that flow here.
//
// Query shape: per-user (uploadedBy = me) AND all three parent FKs
// null. The moment one of entryId / noteId / categoryId gets set, the
// file disappears from this list.

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const sp = await searchParams
  const justShared = typeof sp.ok === 'string' ? Number(sp.ok) : 0
  const oversize = typeof sp.oversize === 'string' ? Number(sp.oversize) : 0
  const shareErr = typeof sp.err === 'string' ? sp.err : null

  const inboxRows = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.uploadedBy, session.user.id),
        isNull(files.entryId),
        isNull(files.noteId),
        isNull(files.categoryId),
      ),
    )
    .orderBy(desc(files.createdAt))

  return (
    <div className="vault-page">
      <div className="flex items-center gap-3 mb-2">
        {/* No onError handler — this is a server component and functions
            can't cross the RSC boundary (Next throws with a numeric
            digest at render). Using save_file_to_box.png since there's
            no dedicated inbox icon in the set yet. */}
        <img src="/icons/cobb/icons/system/save_file_to_box.png" width={48} height={48} alt="" className="object-contain shrink-0 rounded-xl" />
        <h1 className="text-2xl font-bold text-stone-100">Inbox</h1>
        <HelpPopout
          title="Inbox"
          sections={[
            {
              heading: 'What this is',
              tips: [
                { title: 'Android share landing pad', description: 'Files shared into the vault from your phone\'s Share menu queue up here until you sort them onto entries. Per-user — everyone sees only their own shares.' },
                { title: 'NOT the desktop drop folder', description: 'Desktop drops go through the existing Vault File Drop on the import page (Claude-routed). This inbox is just the mobile share path.' },
              ],
            },
            {
              heading: 'How to fill it',
              tips: [
                { title: 'Share from Android', description: 'Open Gallery / Files / Drive / camera / email, tap Share, pick "Family Vault". The file lands here. Requires the PWA installed on your home screen.' },
                { title: 'iOS', description: 'Web Share Target isn\'t supported on iOS PWAs yet — iPhone users use the per-entry file picker instead.' },
              ],
            },
            {
              heading: 'How to clear it',
              tips: [
                { title: 'Attach to entry', description: 'Each row has an "Attach" picker — type to find an entry, click, done. The file leaves the inbox the moment it picks up a parent.' },
                { title: 'Delete', description: 'Trash icon removes the file from the vault entirely.' },
              ],
            },
          ]}
        />
      </div>
      <p className="text-stone-400 text-sm mb-5 max-w-prose">
        Landing pad for files shared into the vault from your phone&rsquo;s Share menu.
        Sort them onto entries when you have a minute. Desktop drops still go through
        the existing <a href="/import" className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-700 hover:decoration-emerald-500">Vault File Drop</a>.
      </p>

      {justShared > 0 && (
        <div className="mb-4 rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-2.5 text-sm text-emerald-200">
          {justShared} file{justShared === 1 ? '' : 's'} added from share.
        </div>
      )}
      {oversize > 0 && (
        <div className="mb-4 rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-200">
          {oversize} file{oversize === 1 ? '' : 's'} skipped — over 25MB.
        </div>
      )}
      {shareErr && (
        <div className="mb-4 rounded-xl border border-red-700/40 bg-red-950/30 px-4 py-2.5 text-sm text-red-200">
          Share failed: {shareErr === 'parse' ? 'could not read the upload.' : shareErr === 'nofile' ? 'no file in the share.' : shareErr === 'readonly' ? 'this account is read-only.' : shareErr}.
        </div>
      )}

      <InboxClient rows={inboxRows.map((f) => ({
        id: f.id,
        filename: f.filename,
        contentType: f.contentType,
        size: f.size,
        createdAt: f.createdAt.toISOString(),
      }))} />
    </div>
  )
}
