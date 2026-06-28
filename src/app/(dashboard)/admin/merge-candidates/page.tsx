import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { entries, categories } from '@/lib/db/schema'
import { isNull } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, GitMerge, Eye, EyeOff } from 'lucide-react'
import { fingerprintEntry, normalizeTitle } from '@/lib/merge-fingerprint'
import { HelpPopout } from '@/components/ui/help-popout'
import { MergeCandidateGroup } from '@/components/ui/merge-candidate-group'
import { decryptEntries } from '@/lib/crypto'

interface Props {
  searchParams: Promise<{ all?: string }>
}

export default async function MergeCandidatesPage({ searchParams }: Props) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'superuser') redirect('/dashboard')

  const showAll = (await searchParams).all === 'true'

  const [topLevelRaw, allCategories] = await Promise.all([
    db.select().from(entries).where(isNull(entries.parentEntryId)),
    db.select().from(categories),
  ])
  const topLevel = decryptEntries(topLevelRaw)
  const catMap = Object.fromEntries(allCategories.map((c) => [c.id, c.name]))

  // Bucket by fingerprint
  const buckets = new Map<string, typeof topLevel>()
  for (const e of topLevel) {
    const fp = fingerprintEntry(e)
    if (!fp) continue
    if (!buckets.has(fp)) buckets.set(fp, [])
    buckets.get(fp)!.push(e)
  }

  // Build groups (>=2 entries) with the everyTitleUnique flag
  type Group = {
    fingerprint: string
    entries: typeof topLevel
    everyTitleUnique: boolean
  }
  const groups: Group[] = []
  for (const [fp, arr] of buckets) {
    if (arr.length < 2) continue
    const norms = arr.map((e) => normalizeTitle(e.title)).filter(Boolean)
    const everyTitleUnique = new Set(norms).size === norms.length && norms.length === arr.length
    groups.push({ fingerprint: fp, entries: arr, everyTitleUnique })
  }

  // Sort: biggest groups first, ties by fingerprint alphabetically
  groups.sort((a, b) => {
    if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length
    return a.fingerprint.localeCompare(b.fingerprint)
  })

  const visible = showAll ? groups : groups.filter((g) => !g.everyTitleUnique)
  const hiddenCount = groups.length - visible.length
  const totalEntriesInVisible = visible.reduce((s, g) => s + g.entries.length, 0)

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-32">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/admin" className="hover:text-stone-300 transition">
          Admin
        </Link>
        <ChevronRight size={14} />
        <span className="text-stone-300">Merge Candidates</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-600/10 border border-amber-600/20">
            <GitMerge size={20} className="text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">Merge Candidates</h1>
              <HelpPopout
                title="Merge Candidates"
                sections={[
                  {
                    heading: 'What this surfaces',
                    tips: [
                      { title: 'Possible duplicates', description: 'Entries grouped by likely-same title / URL / username pattern.' },
                      { title: 'Per-group preview', description: 'See every entry in a group, decide which to keep as the master + which to fold in.' },
                    ],
                  },
                  {
                    heading: 'Merge mechanics',
                    tips: [
                      { title: 'Master wins', description: 'Picked entry keeps its title + IDs; other entries\' fields fill in any gaps then get deleted.' },
                      { title: 'Files & favorites carry over', description: 'Attachments move to the master; favorites union together.' },
                      { title: 'Reversible only via backup', description: 'No undo — restore from /admin or a DB snapshot if you regret it.' },
                    ],
                  },
                  {
                    heading: 'Skip a group',
                    tips: [
                      { title: 'Not a duplicate', description: 'Click "Not a duplicate" — the group hides and won\'t re-appear unless source data changes.' },
                    ],
                  },
                ]}
              />
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              {visible.length} group{visible.length !== 1 ? 's' : ''} · {totalEntriesInVisible} entries
              would collapse into {visible.length} master card{visible.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <Link
          href={showAll ? '/admin/merge-candidates' : '/admin/merge-candidates?all=true'}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-700 text-stone-300 hover:text-stone-100 hover:border-stone-600 transition"
        >
          {showAll ? <EyeOff size={13} /> : <Eye size={13} />}
          {showAll
            ? `Hiding ${hiddenCount === 0 ? '0' : hiddenCount} unique-title groups`
            : `Show all (+${hiddenCount} unique-title groups)`}
        </Link>
      </div>

      {/* Explainer */}
      <div className="mb-6 p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-xs text-amber-200">
        Each card below groups entries that share a website (subdomains folded together) or
        normalized title. Pick one as the <strong>master</strong>, uncheck any rows that don&apos;t
        belong, then Merge. Children get linked to the master and disappear from main listings
        but their credentials stay visible on the master&apos;s detail page.
        {!showAll && (
          <>
            {' '}Groups where every title is unique (e.g. different Google Docs) are hidden by
            default — toggle &quot;Show all&quot; to see them.
          </>
        )}
      </div>

      {/* Groups */}
      {visible.length === 0 ? (
        <div className="text-center py-16 text-stone-500">
          <p className="text-4xl mb-3">✨</p>
          <p className="font-medium text-stone-400">No merge candidates left.</p>
          <p className="text-sm mt-1">Nice and tidy.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((g) => (
            <MergeCandidateGroup
              key={g.fingerprint}
              fingerprint={g.fingerprint}
              entries={g.entries}
              catMap={catMap}
            />
          ))}
        </div>
      )}
    </div>
  )
}
