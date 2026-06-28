import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  Heart,
  Pencil,
} from 'lucide-react'
import { PrintButton } from '@/components/ui/print-button'
import { ensureDeadNowWhatGuide, loadDeadNowWhatGuide } from '@/lib/actions/dead-now-what'
import { GUIDE_PROFILES, SECTION_ORDER, VISIBLE_GUIDE_PROFILES, YEARLY_REVIEW_TAGS, YEARLY_STALE_MS, type GuideProfile } from '@/lib/dead-now-what-config'
import { HelpPopout } from './help-popout'
import { OWNER, getMember, isOwnerEmail } from '@/lib/family-config'
import { decryptNotes } from '@/lib/crypto'
import { LinkifiedText } from '@/components/ui/linkified-text'
import { DeadNowWhatFillWizard } from '@/components/ui/dead-now-what-fill-wizard'
import { cleanGuideContentForReading, paragraphsOf } from '@/lib/guide-reading'

export async function DeadNowWhatGuidePage({ profile }: { profile: GuideProfile }) {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const canEdit = session.user.role !== 'readonly'
  const canManageGuide = canEdit && isGuideOwner(profile, session.user.name, session.user.email)

  const { category } = await ensureDeadNowWhatGuide(profile)

  if (!category) {
    return (
      <div className="p-6 md:p-10 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-stone-100 mb-2">{profile.name}</h1>
        <div className="mt-6 text-center py-16 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">This guide hasn&rsquo;t been set up yet.</p>
          <p className="text-xs mt-1">A superuser needs to open this page once to seed it.</p>
        </div>
      </div>
    )
  }

  const guide = await loadDeadNowWhatGuide(category.id)
  const letter = guide.letter ? decryptNotes([guide.letter])[0] : null
  const topics = decryptNotes(guide.topics)
  const topicStats = topics.map((topic) => ({
    topic,
    stats: getInputStats(topic.content),
    preview: previewSnippet(cleanGuideContentForReading(topic.content)),
  }))
  const readyCount = topicStats.filter((item) => item.stats.status === 'ready').length
  const needsInputCount = topicStats.length - readyCount
  const urgentTopics = topicStats.filter((item) => item.topic.section === 'Start here').slice(0, 2)
  // Stable "now" for this server render — threaded into GuideTopicCard so
  // the yearly-stale check stays pure (Date.now() inside the child trips
  // react-hooks/purity). This page is an `async` server component, so the
  // Date.now() call runs exactly once per request, which is fine.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()

  return (
    <div className="dead-now-what-page px-4 py-6 md:px-8 md:py-10 max-w-6xl mx-auto pb-20">
      {/* Print stylesheet — hides nav chrome, drops backgrounds, recolors
          text for paper. Triggered by the PrintButton below; browser's
          "Save as PDF" destination handles the file output (no PDF lib). */}
      <style>{`
        @media print {
          @page { margin: 0.6in; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .dead-now-what-page { color: #000 !important; max-width: none !important; padding: 0 !important; }
          .dead-now-what-page h1, .dead-now-what-page h2, .dead-now-what-page h3, .dead-now-what-page p, .dead-now-what-page span, .dead-now-what-page a, .dead-now-what-page li { color: #000 !important; }
          .dead-now-what-page section, .dead-now-what-page article { break-inside: avoid; page-break-inside: avoid; }
          .dead-now-what-page .border, .dead-now-what-page [class*='border-'] { border-color: #ccc !important; }
          .dead-now-what-page [class*='bg-'] { background: transparent !important; }
        }
      `}</style>

      {/* Top action bar — print buttons + emergency-sheet shortcut. Hidden
          on the printed view via .no-print so the saved PDF starts at the
          hero. Sized small so it doesn't fight the hero on screen. */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/now-what/emergency-sheet"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition"
        >
          <FileText size={14} />
          Emergency account sheet
        </Link>
        <PrintButton label="Print this guide" />
      </div>

      {/* Hero header — large imgone.png on the left, two-line title
          on the right. Visible to every family member who lands on
          this page, regardless of profile. */}
      <div className="flex items-center gap-4 md:gap-6 mb-8 md:mb-10">
        <img
          src="/icons/cobb/icons/system/imgone.png"
          alt=""
          width={160}
          height={160}
          className="h-32 w-32 md:h-40 md:w-40 object-contain shrink-0 brightness-125 saturate-110"
        />
        <div className="flex-1 min-w-0 leading-none">
          <p className="font-serif font-bold text-stone-50 text-4xl md:text-6xl tracking-tight">I&rsquo;m Dead,</p>
          <p className="font-serif font-bold text-stone-50 text-4xl md:text-6xl tracking-tight mt-2">Now What?</p>
        </div>
      </div>

      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end mb-8 md:mb-10">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-rose-200 bg-rose-950/30 border border-rose-800/40 rounded-full px-3 py-1 mb-4">
            <Heart size={13} className="fill-rose-300/40" />
            Family emergency guide
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-stone-50 tracking-tight flex items-center gap-3 flex-wrap">
            {profile.name}
            <HelpPopout
              title="Dead, Now What?"
              sections={[
                {
                  heading: 'What this is',
                  tips: [
                    { title: 'Family emergency guide', description: 'When someone\'s gone (or incapacitated), this page is the map: who to call, what to do first, where the papers live, what they wanted.' },
                    { title: 'One per person', description: 'Each adult family member can have their own — visible at /now-what/<key>. The default route shows the primary guide.' },
                  ],
                },
                {
                  heading: 'Sections in this guide',
                  tips: [
                    { title: 'First steps', description: 'Immediate-action items: people to contact, the most-urgent decisions in order.' },
                    { title: 'People', description: 'Family contacts, lawyer, financial advisor, doctor — everyone the survivors need to reach.' },
                    { title: 'Money / accounts', description: 'Bank accounts, investments, life insurance, debts. Linked to the vault entries with full credentials.' },
                    { title: 'Wishes', description: 'Burial preferences, funeral instructions, "things I want said", values to live by.' },
                    { title: 'Letters', description: 'Personal letters left for each family member, optionally date-gated.' },
                  ],
                },
                {
                  heading: 'Stay current',
                  tips: [
                    { title: 'Fill wizard', description: 'Walks you through filling each section guided. Easier than starting from a blank page.' },
                    { title: 'Updates', description: 'Edit any section directly; changes are timestamped so future readers see how recent the info is.' },
                  ],
                },
              ]}
            />
          </h1>
          <p className="mt-4 text-base md:text-lg text-stone-300 leading-relaxed max-w-2xl">
            {profile.ownerName}&rsquo;s plan starts with the first decisions, then uses each section as a map to the people,
            papers, accounts, wishes, and instructions the family will need.
          </p>
          <div className="no-print mt-5 flex flex-wrap gap-2">
            {VISIBLE_GUIDE_PROFILES.length > 1 && VISIBLE_GUIDE_PROFILES.map((item) => (
              <Link
                key={item.key}
                href={item.route}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  item.key === profile.key
                    ? 'border-emerald-600 bg-emerald-950/50 text-emerald-100'
                    : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:border-stone-500 hover:text-stone-100'
                }`}
              >
                {item.ownerName}
              </Link>
            ))}
          </div>
        </div>
        <div className="no-print grid grid-cols-3 gap-2 lg:gap-3">
          <Metric label="topics" value={topics.length.toString()} tone="stone" />
          <Metric label="ready" value={readyCount.toString()} tone="emerald" />
          <Metric label="need input" value={needsInputCount.toString()} tone="amber" />
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] mb-9 md:mb-12">
        <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Read first</p>
              <h2 className="text-lg font-semibold text-stone-100 mt-1">Immediate next steps</h2>
            </div>
            <Gauge size={20} className="text-sky-300 shrink-0" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {urgentTopics.map(({ topic, stats, preview }) => (
              <GuideTopicCard
                key={topic.id}
                topic={topic}
                stats={stats}
                preview={preview}
                canEdit={canManageGuide}
                priority
                nowMs={nowMs}
              />
            ))}
          </div>
        </div>

        {canManageGuide ? (
          <div className="no-print">
            <DeadNowWhatFillWizard topics={topics} profileKey={profile.key} />
          </div>
        ) : (
          <div className="rounded-lg border border-stone-800 bg-stone-900/50 p-4 md:p-5">
            <div className="flex items-center gap-2 text-emerald-200 mb-3">
              <ClipboardList size={18} />
              <h2 className="font-semibold">How to use this page</h2>
            </div>
            <p className="text-sm text-stone-300 leading-relaxed">
              Read top to bottom when something just happened. After the urgent cards, jump to the
              section that matches the decision in front of you.
            </p>
          </div>
        )}
      </section>

      {letter && (
        <section className="mb-10 md:mb-12">
          <article className="border-y border-stone-800 py-7 md:py-9">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-rose-300/80 mb-2">
                  From {profile.ownerName}
                </p>
                <h2 className="text-xl md:text-2xl font-semibold text-stone-100">
                  {letter.title}
                </h2>
              </div>
              <BookOpen size={22} className="text-rose-300 shrink-0" />
            </div>
            <div className="max-w-3xl text-stone-200 text-base md:text-lg leading-relaxed md:leading-8 break-words space-y-4 md:space-y-5">
              {/* Render paragraphs explicitly so mobile reflows prose
                  naturally — relying on whitespace-pre-wrap with the
                  source's hard wraps left line breaks scattered through
                  the middle of sentences on narrow screens. */}
              {paragraphsOf(cleanGuideContentForReading(letter.content)).map((para, i) => (
                <p key={i}>
                  <LinkifiedText text={para} />
                </p>
              ))}
            </div>
            {canManageGuide && (
              <div className="no-print mt-5">
                <Link
                  href={`/notes/${letter.id}/edit`}
                  className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-rose-200 transition"
                >
                  <Pencil size={13} />
                  Edit letter
                </Link>
              </div>
            )}
          </article>
        </section>
      )}

      {(() => {
        const bySection = new Map<string, typeof topicStats>()
        for (const item of topicStats) {
          const list = bySection.get(item.topic.section) ?? []
          list.push(item)
          bySection.set(item.topic.section, list)
        }
        const orderedSections = SECTION_ORDER.filter((section) => bySection.has(section))
        for (const section of bySection.keys()) {
          if (!orderedSections.includes(section)) orderedSections.push(section)
        }

        return (
          <div className="space-y-9 md:space-y-12">
            {orderedSections.map((section) => {
              const items = bySection.get(section) ?? []
              const meta = getSectionMeta(section)
              if (items.length === 0) return null
              return (
                <section key={section} className="scroll-mt-8">
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-3">
                    <div>
                      <p className={`text-xs uppercase tracking-[0.22em] ${meta.color}`}>
                        {meta.kicker}
                      </p>
                      <h2 className="text-xl md:text-2xl font-bold text-stone-100 mt-1">
                        {section}
                      </h2>
                    </div>
                    <p className="text-sm text-stone-400 max-w-xl md:text-right">{meta.summary}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.map(({ topic, stats, preview }) => (
                      <GuideTopicCard
                        key={topic.id}
                        topic={topic}
                        stats={stats}
                        preview={preview}
                        canEdit={canManageGuide}
                        nowMs={nowMs}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )
      })()}

      {topics.length === 0 && (
        <div className="text-center py-12 text-stone-500 border border-dashed border-stone-700 rounded-xl">
          <p className="text-sm">No topics yet.</p>
          {canManageGuide && (
            <Link
              href={`/notes/new?categoryId=${category.id}`}
              className="mt-2 inline-block text-emerald-400 hover:text-emerald-300 text-sm transition"
            >
              + Add a topic
            </Link>
          )}
        </div>
      )}

      {canManageGuide && topics.length > 0 && (
        <div className="no-print mt-9 text-center">
          <Link
            href={`/notes/new?categoryId=${category.id}`}
            className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-emerald-300 transition"
          >
            <FileText size={14} />
            Add another guide topic
          </Link>
        </div>
      )}
    </div>
  )
}

function isGuideOwner(profile: GuideProfile, name?: string | null, email?: string | null): boolean {
  const firstName = (name || email || '').split(/[ @._-]/)[0]?.toLowerCase() ?? ''
  const emailLower = (email ?? '').toLowerCase()
  const localPart = emailLower.split('@')[0]

  if (firstName === profile.ownerName.toLowerCase()) return true

  // Primary guide → check the OWNER's emails + aliases.
  if (profile.key === GUIDE_PROFILES[0]?.key) {
    if (isOwnerEmail(emailLower)) return true
    if (localPart && OWNER.aliases?.includes(localPart)) return true
    return false
  }

  // Secondary guide → look up the matching member by guide key (slug).
  const member = getMember(profile.key)
  if (member?.emails?.some((e) => e.toLowerCase() === emailLower)) return true
  if (localPart && localPart === member?.slug) return true
  return false
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'stone' | 'emerald' | 'amber' }) {
  const tones = {
    stone: 'border-stone-800 bg-stone-900/60 text-stone-100',
    emerald: 'border-emerald-800/40 bg-emerald-950/20 text-emerald-200',
    amber: 'border-amber-800/40 bg-amber-950/20 text-amber-200',
  }
  return (
    <div className={`rounded-lg border p-3 text-center ${tones[tone]}`}>
      <div className="text-xl md:text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</div>
    </div>
  )
}

function GuideTopicCard({
  topic,
  stats,
  preview,
  canEdit,
  priority = false,
  nowMs,
}: {
  topic: { id: string; title: string; section: string; content: string; tags?: string[] | null; updatedAt?: Date | null }
  stats: InputStats
  preview: string
  canEdit: boolean
  priority?: boolean
  /** Stable timestamp from the server render — passed in so the yearly-stale
   *  computation stays pure (Date.now() during render is impure). */
  nowMs: number
}) {
  const statusStyle =
    stats.status === 'ready'
      ? 'text-emerald-200 bg-emerald-950/30 border-emerald-800/40'
      : stats.status === 'started'
        ? 'text-sky-200 bg-sky-950/30 border-sky-800/40'
        : 'text-amber-200 bg-amber-950/30 border-amber-800/40'

  // Yearly-review affordance — show a small pill when this topic carries
  // a needsYearlyReview tag. Goes red ("Review due") when the underlying
  // note hasn't been touched in > 12 months; stays warm amber ("Yearly")
  // when the answer is still fresh. Lance asked for this so financial /
  // tax / insurance answers don't quietly rot once entered.
  const yearlyTag = (topic.tags ?? []).find((t) => YEARLY_REVIEW_TAGS.has(t))
  const yearlyStale = yearlyTag != null
    && (!topic.updatedAt || nowMs - topic.updatedAt.getTime() > YEARLY_STALE_MS)

  return (
    <Link
      href={`/notes/${topic.id}`}
      className={`group rounded-lg border transition p-4 flex min-h-[152px] flex-col ${
        priority
          ? 'border-sky-800/50 bg-sky-950/15 hover:border-sky-500/60'
          : 'border-stone-800 bg-stone-900/55 hover:border-stone-600 hover:bg-stone-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-stone-100 leading-snug group-hover:text-emerald-200 transition">
          {topic.title}
        </h3>
        <ArrowRight size={16} className="text-stone-600 group-hover:text-emerald-300 transition shrink-0 mt-0.5" />
      </div>
      {preview ? (
        <p className="text-sm text-stone-400 leading-relaxed mt-3">{preview}</p>
      ) : (
        <p className="text-sm text-stone-500 leading-relaxed mt-3">Open this topic and add the details the family will need.</p>
      )}
      <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${statusStyle}`}>
          {stats.status === 'ready' ? <CheckCircle2 size={12} /> : <ClipboardList size={12} />}
          {stats.label}
        </span>
        {yearlyTag && (
          <span
            className={
              yearlyStale
                ? 'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold tracking-wider uppercase text-red-200 bg-red-950/40 border-red-800/50'
                : 'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold tracking-wider uppercase text-amber-200 bg-amber-950/30 border-amber-800/40'
            }
            title={yearlyStale ? 'This answer was last touched over a year ago — review it.' : 'Re-check this one yearly.'}
          >
            {yearlyStale ? 'Review due' : 'Yearly'}
          </span>
        )}
        {canEdit && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-stone-500 group-hover:text-stone-300 transition">
            <Pencil size={12} />
            Edit
          </span>
        )}
      </div>
    </Link>
  )
}

interface InputStats {
  blanks: number
  status: 'needs-input' | 'started' | 'ready'
  label: string
}

function getInputStats(content: string): InputStats {
  const blanks = content.match(/_{3,}/g)?.length ?? 0
  if (blanks === 0) return { blanks, status: 'ready', label: 'Ready' }
  if (blanks <= 3) return { blanks, status: 'started', label: `${blanks} blank${blanks === 1 ? '' : 's'} left` }
  return { blanks, status: 'needs-input', label: `${blanks} blanks left` }
}

function getSectionMeta(section: string): { kicker: string; summary: string; color: string } {
  const meta: Record<string, { kicker: string; summary: string; color: string }> = {
    'Start here': {
      kicker: 'First decisions',
      summary: 'The only pieces that should be read before anything else.',
      color: 'text-sky-300',
    },
    Personal: {
      kicker: 'Who I was',
      summary: 'Identity, family history, and facts that paperwork tends to ask for.',
      color: 'text-rose-300',
    },
    'Identity & legal': {
      kicker: 'Authority',
      summary: 'Documents that prove identity, name decision-makers, and unlock legal steps.',
      color: 'text-violet-300',
    },
    Money: {
      kicker: 'Accounts',
      summary: 'Financial map, claims, bills, debts, taxes, and benefits.',
      color: 'text-emerald-300',
    },
    Property: {
      kicker: 'Places and things',
      summary: 'Homes, vehicles, valuables, inventory, and physical handoffs.',
      color: 'text-amber-300',
    },
    'Health & end of life': {
      kicker: 'Care and wishes',
      summary: 'Medical context, arrangements, memorial details, and final preferences.',
      color: 'text-teal-300',
    },
    Pets: {
      kicker: 'Care',
      summary: 'Immediate animal care and longer-term plans.',
      color: 'text-lime-300',
    },
    Digital: {
      kicker: 'Access',
      summary: 'Accounts, recovery paths, devices, and digital assets.',
      color: 'text-cyan-300',
    },
    Misc: {
      kicker: 'Household',
      summary: 'Utilities, routines, networks, and service providers.',
      color: 'text-orange-300',
    },
  }
  return meta[section] ?? {
    kicker: 'Additional',
    summary: 'Extra notes that do not fit the standard guide sections.',
    color: 'text-stone-400',
  }
}

function previewSnippet(content: string): string {
  if (!content) return ''
  const firstReal = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.includes('__________') && !line.startsWith('-'))
  if (!firstReal) return ''
  return firstReal.length > 150 ? firstReal.slice(0, 147) + '...' : firstReal
}
