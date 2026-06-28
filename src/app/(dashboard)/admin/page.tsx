import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users, invites, categories, subcategories } from '@/lib/db/schema'
import { desc, asc } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, ArrowUpCircle } from 'lucide-react'
import { UserRow } from '@/components/ui/user-row'
import { HelpPopout } from '@/components/ui/help-popout'
import { InviteForm } from '@/components/ui/invite-form'
import { InviteRow } from '@/components/ui/invite-row'
import { CategoryEditor } from '@/components/ui/category-editor'
import { CobbBanner } from '@/components/ui/cobb-banner'
import { UpgradeRequestRow } from '@/components/ui/upgrade-request-row'
import { FamilySetupButtons } from '@/components/ui/family-setup-buttons'
import { CopyCommandButton } from '@/components/ui/copy-command-button'
import { listPendingUpgradeRequests } from '@/lib/actions/upgrade-requests'
import { getCobbIcons } from '@/lib/cobb-icons'

export default async function AdminPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') redirect('/dashboard')

  const isSuperuser = session.user.role === 'superuser'

  const [allUsers, allInvites, allCats, allSubs, cobbIcons] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt),
    db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        status: invites.status,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .orderBy(desc(invites.createdAt))
      .limit(50),
    db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        icon: categories.icon,
        description: categories.description,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder)),
    db
      .select({
        id: subcategories.id,
        categoryId: subcategories.categoryId,
        name: subcategories.name,
        icon: subcategories.icon,
        description: subcategories.description,
        sortOrder: subcategories.sortOrder,
      })
      .from(subcategories)
      .orderBy(asc(subcategories.sortOrder)),
    getCobbIcons(),
  ])
  let pendingRequests: Awaited<ReturnType<typeof listPendingUpgradeRequests>> = []
  try {
    pendingRequests = await listPendingUpgradeRequests()
  } catch (err) {
    console.warn('[admin] listPendingUpgradeRequests failed:', err instanceof Error ? err.message : err)
  }

  const catsWithSubs = allCats.map((cat) => ({
    ...cat,
    subs: allSubs.filter((s) => s.categoryId === cat.id),
  }))

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <CobbBanner compact />
      <div className="mb-6 md:mb-8">
        <h1 className="flex items-center gap-4 text-2xl font-bold text-stone-100">
          <img src="/icons/cobb/icons/system/adminx.png" width={104} height={104} alt="" className="h-[104px] w-[104px] object-contain rounded" />
          Admin Panel
          <HelpPopout
            title="Admin Panel"
            sections={[
              {
                heading: 'People',
                tips: [
                  { title: 'Invite family', description: 'Send a magic-link invite to a new family member. Pick their role on send.' },
                  { title: 'Role changes', description: 'Promote / demote anyone — superuser, admin, member, read-only. Self-promote is blocked.' },
                  { title: 'Upgrade requests', description: 'Family members asking for write access. Click to approve or decline.' },
                ],
              },
              {
                heading: 'Vault maintenance',
                tips: [
                  { title: 'Audit', description: 'Find stale entries — expired cards, untouched logins, empty rows. Decide one-by-one.' },
                  { title: 'Files', description: 'Global file browser — reassign, re-attach, bulk-delete.' },
                  { title: 'Merge candidates', description: 'Possible duplicates surfaced by title/URL match. Approve to collapse them into one entry.' },
                  { title: 'Mass reclassify', description: 'Move many entries to a new category/sub at once.' },
                ],
              },
              {
                heading: 'Behind-the-scenes',
                tips: [
                  { title: 'Legacy', description: 'Dead Man\'s Switch reference + design-review notes.' },
                  { title: 'Categories', description: 'Manage the category tree, sort order, icons. Subcategory seeding for recipes happens automatically.' },
                ],
              },
            ]}
          />
        </h1>
        <p className="text-stone-400 text-sm mt-0.5">Manage family members and access.</p>
      </div>

      {/* Pending upgrade requests — surface at top so admins notice */}
      {pendingRequests.length > 0 && (
        <section className="mb-8 md:mb-10">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider mb-3 text-amber-300">
            <ArrowUpCircle size={16} className="text-amber-400" />
            Upgrade Requests ({pendingRequests.length})
          </h2>
          <div className="space-y-2">
            {pendingRequests.map((r) => (
              <UpgradeRequestRow key={r.id} request={r} isSuperuser={isSuperuser} />
            ))}
          </div>
        </section>
      )}

      {/* Tools — links to admin sub-pages so they're reachable on mobile too */}
      <section className="mb-8 md:mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">Tools</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {isSuperuser && (
            <Link
              href="/admin/merge-candidates"
              className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-amber-700/50 rounded-xl transition group"
            >
              <img src="/icons/cobb/icons/system/merge_files.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100">Merge Candidates</p>
                <p className="text-xs text-stone-400 mt-0.5">Find duplicate-site entries and bundle them under one master.</p>
              </div>
              <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
            </Link>
          )}
          {isSuperuser && (
            <Link
              href="/admin/cleanup-credentials"
              className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-red-700/50 rounded-xl transition group"
            >
              <img src="/icons/cobb/icons/system/show_password.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100">Cleanup Credentials</p>
                <p className="text-xs text-stone-400 mt-0.5">Triage fat merged groups — auto-flags exact dupes, bulk-delete the chaff.</p>
              </div>
              <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
            </Link>
          )}
          <Link
            href="/admin/reclassify"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-sky-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/mass_reclassify.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Mass Reclassify</p>
              <p className="text-xs text-stone-400 mt-0.5">Select many entries and move them to a new category or subcategory.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/admin/audit"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-amber-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/stale_entries.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Stale Entry Audit</p>
              <p className="text-xs text-stone-400 mt-0.5">Expired cards, abandoned logins, and bare entries — review and clean up.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/import"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-emerald-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/bulk_import.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Bulk Import</p>
              <p className="text-xs text-stone-400 mt-0.5">Upload entries from CSV or notes from text/CSV files.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          {isSuperuser && (
            <Link
              href="/admin/files"
              className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-sky-700/50 rounded-xl transition group"
            >
              <img src="/icons/cobb/icons/system/browse_files.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100">Files</p>
                <p className="text-xs text-stone-400 mt-0.5">Browse every file in the vault, reassign to different categories, delete.</p>
              </div>
              <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
            </Link>
          )}
          <Link
            href="/admin/icons"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-emerald-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/browse_files.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Icon Browser</p>
              <p className="text-xs text-stone-400 mt-0.5">Find any icon under /public/icons by name or folder; click to copy its path.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          {isSuperuser && (
            <Link
              href="/admin/legacy"
              className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-purple-700/50 rounded-xl transition group"
            >
              <img src="/icons/cobb/icons/system/deadman.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100">Dead Man&rsquo;s Switch</p>
                <p className="text-xs text-stone-400 mt-0.5">Review the plan for releasing letters after you&rsquo;re gone.</p>
              </div>
              <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
            </Link>
          )}
          <Link
            href="/letters"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-pink-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/dad_love_letters.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-100">Family Letters</p>
              <p className="text-xs text-stone-400 mt-0.5">Write or record love letters for the family. Voice + video supported.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/admin/capabilities"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-emerald-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/browse_files.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Capabilities</p>
              <p className="text-xs text-stone-400 mt-0.5">Everything this app can do, grouped by feature area. Printable / save as PDF.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/under-the-hood"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-sky-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/adminx.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Under the Hood</p>
              <p className="text-xs text-stone-400 mt-0.5">Pseudo-technical overview — stack, security, AI, integrations, automation. Print-friendly for sharing.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/admin/emergency-sheet"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-emerald-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/IDNW.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Emergency sheet logins</p>
              <p className="text-xs text-stone-400 mt-0.5">Pick which logins surface on the printable emergency account sheet (linked from the IDNW page).</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
          <Link
            href="/admin/password-cleanup"
            className="flex items-center gap-3 p-4 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-red-700/50 rounded-xl transition group"
          >
            <img src="/icons/cobb/icons/system/add_password.png" width={40} height={40} alt="" className="object-contain rounded shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-100">Password cleanup</p>
              <p className="text-xs text-stone-400 mt-0.5">Browse every login at once, sort by domain to cluster duplicates, click to delete in bulk. CSV snapshot downloads before deletion.</p>
            </div>
            <ChevronRight size={16} className="text-stone-500 group-hover:text-stone-300 shrink-0" />
          </Link>
        </div>
      </section>

      {/* Maintenance — one-off diagnostic scripts wrapped as copy-to-
          clipboard buttons. Clicking grabs the PowerShell command; the
          user pastes it in their terminal at C:\Projects\cobbvault. */}
      {isSuperuser && (
        <section className="mb-8 md:mb-10">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
            Maintenance
          </h2>
          <div className="rounded-xl border border-stone-700/50 bg-stone-800/40 p-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-stone-100">Check for duplicate IDNW topics</p>
              <p className="text-xs text-stone-400 mt-0.5 mb-2">
                Dry-run only — lists what it would delete. Run periodically while filling the guide so
                duplicate copies of the same topic don&rsquo;t poison the fill wizard.
              </p>
              <CopyCommandButton
                command="cd C:\Projects\cobbvault; npx tsx --env-file=.env.local scripts/dedupe-idnw-topics.ts"
                label="Copy dupe-check command"
                hint="Paste in PowerShell"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-100">Apply duplicate IDNW cleanup</p>
              <p className="text-xs text-stone-400 mt-0.5 mb-2">
                Same script with <code className="bg-stone-900 px-1 py-0.5 rounded">--apply</code>.
                Deletes the duplicates the dry-run found. Run only after the dry-run looks right.
              </p>
              <CopyCommandButton
                command="cd C:\Projects\cobbvault; npx tsx --env-file=.env.local scripts/dedupe-idnw-topics.ts --apply"
                label="Copy dupe-cleanup command"
                hint="Paste in PowerShell"
              />
            </div>
          </div>
        </section>
      )}

      {/* Family setup — superuser-only one-shot scaffolding */}
      {isSuperuser && (
        <section className="mb-8 md:mb-10">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">
            Family Setup
          </h2>
          <FamilySetupButtons />
        </section>
      )}

      {/* Categories */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">
          Categories &amp; Subcategories
        </h2>
        <CategoryEditor cats={catsWithSubs} cobbIcons={cobbIcons} />
      </section>

      {/* Users */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">
          Family Members ({allUsers.length} / 10)
        </h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl overflow-hidden">
          {allUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              currentUserId={session.user.id}
              isSuperuser={isSuperuser}
            />
          ))}
        </div>
      </section>

      {/* Send Invite */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">Send Invite</h2>
        <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl p-6">
          <InviteForm isSuperuser={isSuperuser} />
        </div>
      </section>

      {/* Pending Invites */}
      <section>
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-4">
          Invites ({allInvites.filter((i) => i.status === 'pending').length} pending)
        </h2>
        {allInvites.length === 0 ? (
          <p className="text-stone-600 text-sm">No invites sent yet.</p>
        ) : (
          <div className="bg-stone-800/40 border border-stone-700/50 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-700/50">
                  <th className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-5 py-3">Email</th>
                  <th className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-5 py-3">Role</th>
                  <th className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-5 py-3">Expires</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {allInvites.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
