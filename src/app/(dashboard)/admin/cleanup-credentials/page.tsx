import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'
import { eq, inArray, isNotNull } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CleanupCredentialsClient } from '@/components/ui/cleanup-credentials-client'
import { HelpPopout } from '@/components/ui/help-popout'
import { decryptEntries } from '@/lib/crypto'

// Triage page for merged-credential groups with too many children.
// Shows every group sorted by child-count descending so the worst
// offenders surface first. Each child renders its username + masked
// password; exact duplicates get pre-ticked client-side. Superuser-only
// because bulk-deleting other users' credentials needs broad reach.

export default async function CleanupCredentialsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser') redirect('/dashboard')

  // Pull every child entry (parentEntryId IS NOT NULL). Bucket by parent.
  // We use a single broad query rather than per-parent fetches because
  // there's no useful index on parentEntryId-with-aggregation and the
  // total entry count is small enough (~thousands).
  const allChildrenRaw = await db
    .select({
      id: entries.id,
      title: entries.title,
      username: entries.username,
      password: entries.password,
      url: entries.url,
      type: entries.type,
      parentEntryId: entries.parentEntryId,
      isPrivate: entries.isPrivate,
      isPersonal: entries.isPersonal,
      createdBy: entries.createdBy,
      createdAt: entries.createdAt,
      categoryId: entries.categoryId,
    })
    .from(entries)
    .where(isNotNull(entries.parentEntryId))

  if (allChildrenRaw.length === 0) {
    return <EmptyState />
  }

  // Collect parent IDs whose children we just fetched, then pull the
  // matching masters in one query.
  const parentIds = Array.from(new Set(allChildrenRaw.map((c) => c.parentEntryId!).filter(Boolean)))
  const [parentsRaw, allCategories] = await Promise.all([
    db.select().from(entries).where(inArray(entries.id, parentIds)),
    db.select().from(categories),
  ])

  const parents = decryptEntries(parentsRaw)
  const children = decryptEntries(allChildrenRaw)
  const catMap = Object.fromEntries(allCategories.map((c) => [c.id, c.name]))

  // Bucket children under their parent. Drop any parent that doesn't
  // have at least 2 children — a 1-child "group" isn't worth triaging.
  const byParent = new Map<string, typeof children>()
  for (const child of children) {
    if (!child.parentEntryId) continue
    if (!byParent.has(child.parentEntryId)) byParent.set(child.parentEntryId, [])
    byParent.get(child.parentEntryId)!.push(child)
  }

  type GroupRow = {
    parentId: string
    parentTitle: string
    parentUsername: string | null
    parentPassword: string | null
    parentUrl: string | null
    categoryName: string
    children: typeof children
  }

  const groups: GroupRow[] = []
  for (const parent of parents) {
    const kids = byParent.get(parent.id) ?? []
    if (kids.length < 2) continue
    // Sort children oldest-first so the auto-tick logic can keep [0].
    kids.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    groups.push({
      parentId: parent.id,
      parentTitle: parent.title,
      parentUsername: parent.username,
      parentPassword: parent.password,
      parentUrl: parent.url,
      categoryName: catMap[parent.categoryId] ?? 'Uncategorized',
      children: kids,
    })
  }

  // Biggest groups first.
  groups.sort((a, b) => b.children.length - a.children.length)

  const totalChaff = groups.reduce((sum, g) => sum + g.children.length, 0)
  const exactDupeCount = groups.reduce((sum, g) => sum + countExactDupes(g.children), 0)

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Cleanup credentials</span>
      </nav>

      <div className="flex items-start gap-3 mb-6">
        <img src="/icons/cobb/icons/system/merge_files.png" width={72} height={72} alt="" className="object-contain rounded shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-stone-100">Cleanup linked credentials</h1>
            <HelpPopout
              title="Cleanup credentials"
              sections={[
                {
                  heading: 'What this page does',
                  tips: [
                    { title: 'Per-group triage', description: 'Every entry that has 2 or more linked credentials shows up here, biggest first. Each child has a checkbox.' },
                    { title: 'Auto-detected dupes', description: 'Children with identical username + password are pre-ticked (keeping the oldest one) so you can blast through them.' },
                    { title: 'Group delete', description: 'Dead account entirely? The trash icon next to the group name nukes the master + every child in one go.' },
                  ],
                },
                {
                  heading: 'Safety',
                  tips: [
                    { title: 'Superuser only', description: 'This page is gated to superusers. Bulk operations can’t touch other users’ personal items — those stay invisible.' },
                    { title: 'Un-parent on delete', description: 'Deleting a master without ticking its children un-parents them so they survive as standalone entries.' },
                  ],
                },
              ]}
            />
          </div>
          <p className="text-sm text-stone-400 mt-1">
            {groups.length} group{groups.length === 1 ? '' : 's'} · {totalChaff} linked credentials ·{' '}
            <span className="text-amber-300">{exactDupeCount} exact dupe{exactDupeCount === 1 ? '' : 's'}</span> pre-flagged
          </p>
        </div>
      </div>

      <CleanupCredentialsClient groups={groups} />
    </div>
  )
}

function countExactDupes(children: { username: string | null; password: string | null }[]): number {
  let dupes = 0
  const seen = new Set<string>()
  for (const c of children) {
    const key = `${c.username ?? ''}|${c.password ?? ''}`
    if (!c.username && !c.password) continue
    if (seen.has(key)) dupes++
    else seen.add(key)
  }
  return dupes
}

function EmptyState() {
  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/admin" className="hover:text-stone-300 transition">Admin</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Cleanup credentials</span>
      </nav>
      <h1 className="text-2xl font-bold text-stone-100 mb-2">Cleanup linked credentials</h1>
      <div className="mt-6 rounded-2xl border border-stone-800 bg-stone-900/40 p-8 text-center">
        <p className="text-stone-300 font-medium">No merged groups to triage.</p>
        <p className="text-stone-500 text-sm mt-1">Every login is either standalone or a single-credential group.</p>
      </div>
    </div>
  )
}
