'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Search, Eye, Check, Pencil, GitMerge, X, FileText, Image as ImageIcon, Download, File as FileIcon, User, Mail, Phone, Paperclip, Plus } from 'lucide-react'
import { HelpPopout } from '@/components/ui/help-popout'
import { clsx } from 'clsx'
import { searchVault, mergeEntries } from '@/lib/actions/entries'
import { SearchNotePeek } from '@/components/ui/search-note-peek'
import { FilePreviewButton, isPreviewable } from '@/components/ui/file-preview'
import { formatBytes, formatEntryType } from '@/lib/format'
import type { InferSelectModel } from 'drizzle-orm'
import type { entries, notes } from '@/lib/db/schema'

type Entry = InferSelectModel<typeof entries> & { linkedCount?: number; attachmentCount?: number }
type Note = InferSelectModel<typeof notes> & { attachmentCount?: number }
interface FileResult {
  id: string
  filename: string
  contentType: string
  size: number
  parentLabel: string
  parentHref: string | null
  parentType: 'entry' | 'note' | 'category' | null
  downloadHref: string
}
interface ContactResult {
  id: string
  displayName: string
  emails: Array<{ value: string; type?: string | null }>
  phones: Array<{ value: string; type?: string | null }>
  organization: string | null
  jobTitle: string | null
}
type SearchResults = { entries: Entry[]; notes: Note[]; files: FileResult[]; contacts: ContactResult[] }

export default function SearchPage() {
  // Search field starts empty on every visit by default. We DO accept a
  // one-shot ?q=… on initial mount (used by the sidebar quick-search) but
  // we never write the URL back as the user types — that's what caused
  // the mobile click-eating bug previously.
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => (searchParams.get('q') ?? '').trim())
  const [results, setResults] = useState<SearchResults | null>(null)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [masterId, setMasterId] = useState<string | null>(null)
  const [merging, startMergeTransition] = useTransition()
  // Toggle for "show only entries with attachments" — useful for finding
  // every card that has a statement / receipt / scan on it. Server-side
  // filter (see searchVault opts.hasFilesOnly); doesn't affect notes,
  // files, or contacts sections.
  const [hasFilesOnly, setHasFilesOnly] = useState(false)

  // Hero placeholder shown when there's no active query. Picked client-side
  // post-mount to avoid an SSR/hydration mismatch — null on first paint, then
  // settles to a random pick.
  const [heroImg, setHeroImg] = useState<string | null>(null)
  useEffect(() => {
    const imgs = [
      '/icons/cobb/rivervault.png',
      '/icons/cobb/animals.png',
      '/icons/cobb/cfv-2animals-logo.png',
    ]
    setHeroImg(imgs[Math.floor(Math.random() * imgs.length)])
  }, [])

  // Run search whenever query changes (debounced via URL update) OR the
  // hasFilesOnly toggle flips — the filter is server-side, so flipping
  // the chip needs a re-fetch to reshape the entries list.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      return
    }
    startTransition(async () => {
      const r = await searchVault(query, { hasFilesOnly })
      setResults(r)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, hasFilesOnly])

  // Mirror the current query into the URL bar (debounced) so the
  // browser back button restores the search state. Critical: we use
  // window.history.replaceState DIRECTLY rather than router.replace —
  // router.replace triggers a Next re-render that eats taps on mobile
  // while typing (the original reason this was disabled). replaceState
  // just rewrites the URL without involving React.
  //
  // Flow: type "ionos" → 400ms later URL becomes /search?q=ionos →
  // tap a result → /entries/xyz → hit back → browser restores
  // /search?q=ionos → useState seeds from URL → effect re-runs search
  // → same result list reappears.
  useEffect(() => {
    const trimmed = query.trim()
    const handle = setTimeout(() => {
      const url = new URL(window.location.href)
      const current = url.searchParams.get('q') ?? ''
      if (trimmed.length === 0) {
        if (current) {
          url.searchParams.delete('q')
          window.history.replaceState({}, '', url.pathname + (url.search || ''))
        }
      } else if (current !== trimmed) {
        url.searchParams.set('q', trimmed)
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [query])

  function handleQueryChange(q: string) {
    setQuery(q)
  }

  // Dismiss the on-screen keyboard the instant the user starts touching
  // a result. iOS Safari and some Android browsers consume the first tap
  // as a "dismiss keyboard" gesture when the search input is focused,
  // which used to silently swallow the click on a result row. Blurring on
  // touchstart fires before the click resolves, so the keyboard hides and
  // the tap completes against the result.
  function blurSearchInput() {
    inputRef.current?.blur()
    // Also force the URL into sync with the current query NOW (not
    // when the 400ms debounce fires) — touchstart/mousedown on a
    // result row fires before the link's click navigates away, so
    // we make sure the URL has ?q=… in it BEFORE we leave the page.
    // Otherwise tapping a result while the debounce timer is still
    // running drops you onto a queryless /search when you hit back.
    const trimmed = query.trim()
    if (trimmed.length > 0) {
      const url = new URL(window.location.href)
      if (url.searchParams.get('q') !== trimmed) {
        url.searchParams.set('q', trimmed)
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (masterId === id) setMasterId(null)
      } else {
        next.add(id)
        if (!masterId) setMasterId(id)
      }
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setMasterId(null)
  }

  function handleMerge() {
    if (selectedIds.size < 2 || !masterId) return
    startMergeTransition(async () => {
      const result = await mergeEntries([...selectedIds], masterId)
      if (!result?.error) {
        exitSelectMode()
        // Re-run search to reflect merge (children disappear)
        const r = await searchVault(query, { hasFilesOnly })
        setResults(r)
      }
    })
  }

  const total = (results?.entries.length ?? 0) + (results?.notes.length ?? 0) + (results?.files.length ?? 0) + (results?.contacts.length ?? 0)
  const masterEntry = masterId ? results?.entries.find((e) => e.id === masterId) : null

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-32">
      <h1 className="text-2xl font-bold text-stone-100 mb-6 flex items-center gap-2">
        <img src="/icons/cobb/icons/system/search.png" width={72} height={72} alt="" className="object-contain rounded" />
        Search the Vault
        <HelpPopout
          title="Search"
          sections={[
            {
              heading: 'What gets searched',
              tips: [
                { title: 'Entries', description: 'Title, username, URL, notes, custom fields, and every encrypted field (passwords, account/card numbers, SSN, passport, license, CVV). Decrypted on the server during the query.' },
                { title: 'Notes', description: 'Title + body + tags — including recipe ingredients/instructions, which live in the note body.' },
                { title: 'Files', description: 'Filenames only — for in-document text use /ask or open the file and use the Sparkles button.' },
                { title: 'Contacts', description: 'Your Gmail contacts: name, organization, job title, email addresses, phone numbers, and notes.' },
              ],
            },
            {
              heading: 'Query syntax',
              tips: [
                { title: 'AND across terms', description: 'bank america → matches "bank" AND "america" anywhere (any order, any field).' },
                { title: 'Exact phrase', description: 'Wrap in quotes: "bank of america" → must appear in that exact order.' },
                { title: 'Mix both', description: '"bank of america" lance → exact phrase plus the word lance somewhere.' },
              ],
            },
            {
              heading: 'Live results',
              tips: [
                { title: 'As-you-type', description: 'Results stream in while you type. Hit Enter / search button to dismiss the keyboard.' },
                { title: 'Visibility honored', description: 'Private + Personal items only appear if you\'re allowed to see them.' },
              ],
            },
          ]}
        />
      </h1>

      {/* Wrapped in a <form> so tapping the keyboard's "search" button (or
          hitting Enter) blurs the input and dismisses the on-screen
          keyboard — search runs as you type, so this is purely "I'm done
          typing, get out of my way." */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          inputRef.current?.blur()
        }}
        className="relative mb-2"
      >
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" />
        <input
          ref={inputRef}
          type="search"
          autoFocus
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder='Search names, sites, notes, usernames…'
          className="w-full pl-11 pr-4 py-3.5 bg-stone-800 border border-stone-600 rounded-xl text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition text-lg"
        />
        {isPending && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        )}
      </form>
      <p className="text-[11px] text-stone-500 mb-6 px-1">
        One word: type and go. Two or more: every word has to appear (any order).
        Wrap in quotes to require an exact phrase — e.g. <code className="text-stone-400">&ldquo;bank of america&rdquo;</code>.
      </p>

      {results && (
        // Touch-start anywhere in the results container blurs the search
        // input. iOS/Android consume the first tap-to-dismiss the keyboard,
        // which used to drop clicks on result rows; doing it explicitly on
        // touchstart fires BEFORE the click, so the keyboard hides and the
        // tap reaches the link.
        <div onTouchStart={blurSearchInput} onMouseDown={blurSearchInput}>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <p className="text-sm text-stone-500">
              {total} result{total !== 1 ? 's' : ''} for <span className="text-stone-300">&quot;{query}&quot;</span>
            </p>
            <div className="flex items-center gap-2">
              {/* "Has files" toggle — server-side filter that drops every
                  entry without an attachment. Useful for "show me every
                  card with a statement on it" sweeps. Affects entries
                  only; notes/files/contacts sections are untouched. */}
              <button
                type="button"
                onClick={() => setHasFilesOnly((v) => !v)}
                aria-pressed={hasFilesOnly}
                title={hasFilesOnly ? 'Showing only entries with attachments' : 'Show only entries with attachments'}
                className={clsx(
                  'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition',
                  hasFilesOnly
                    ? 'bg-sky-950/50 border-sky-700/60 text-sky-200'
                    : 'border-stone-700 text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                )}
              >
                <Paperclip size={13} />
                Has files
              </button>
              {results.entries.length >= 2 && (
                <button
                  type="button"
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  className={clsx(
                    'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition',
                    selectMode
                      ? 'bg-stone-700 border-stone-600 text-stone-200'
                      : 'border-amber-700/50 text-amber-300 hover:bg-amber-950/40 hover:border-amber-600'
                  )}
                >
                  {selectMode ? <><X size={13} /> Cancel</> : <><GitMerge size={13} /> Merge</>}
                </button>
              )}
            </div>
          </div>

          {selectMode && (
            <div className="mb-4 p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-xs text-amber-200">
              <p className="mb-1 font-medium">Merge mode</p>
              <p className="text-amber-300/80">
                Tick the cards to combine. Pick which one is the <span className="font-semibold text-amber-200">master</span> — that&apos;s the card that will stay visible. All the other usernames, passwords and notes will be kept inside it as a &quot;Linked Credentials&quot; list (no data is deleted).
              </p>
            </div>
          )}

          {results.entries.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-3">Entries</h2>
              <div className="flex flex-col gap-2">
                {results.entries.map((entry) => (
                  <SearchEntryRow
                    key={entry.id}
                    entry={entry}
                    selectMode={selectMode}
                    selected={selectedIds.has(entry.id)}
                    isMaster={masterId === entry.id}
                    onToggle={toggleSelect}
                    onPickMaster={(id) => setMasterId(id)}
                  />
                ))}
              </div>
            </section>
          )}

          {results.notes.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-3">Notes</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                {results.notes.map((note) => (
                  <SearchNotePeek key={note.id} note={note} />
                ))}
              </div>
            </section>
          )}

          {results.files.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-3">Files</h2>
              <div className="flex flex-col gap-2">
                {results.files.map((f) => (
                  <FileResultRow key={f.id} file={f} />
                ))}
              </div>
            </section>
          )}

          {results.contacts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-3">Contacts</h2>
              <div className="flex flex-col gap-2">
                {results.contacts.map((c) => (
                  <ContactResultRow key={c.id} contact={c} />
                ))}
              </div>
            </section>
          )}

          {total === 0 && (
            <div className="text-center py-16 text-stone-500">
              <p className="text-4xl mb-3">🔍</p>
              <p className="font-medium text-stone-400">Nothing found.</p>
              <p className="text-sm mt-1 mb-4">Try a different term, or start a new one:</p>
              <CreatePills />
            </div>
          )}
        </div>
      )}

      {!results && query.length === 0 && heroImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroImg}
          alt=""
          className="w-full rounded-2xl object-contain"
        />
      )}

      {/* Sticky merge action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 z-[60] p-4 bg-stone-950/95 backdrop-blur border-t border-amber-800/40">
          <div className="max-w-4xl mx-auto flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-amber-300 shrink-0">
              {selectedIds.size} selected
            </span>
            <span className="text-stone-600">·</span>
            <span className="text-xs text-stone-400 min-w-0 truncate">
              Master: <span className="text-amber-200 font-medium">{masterEntry?.title ?? '— pick one —'}</span>
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleMerge}
              disabled={selectedIds.size < 2 || !masterId || merging}
              className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition flex items-center gap-1.5"
            >
              <GitMerge size={14} />
              {merging
                ? 'Merging...'
                : selectedIds.size < 2
                  ? 'Pick 2+ to merge'
                  : !masterId
                    ? 'Pick master'
                    : `Merge ${selectedIds.size} into "${masterEntry?.title?.slice(0, 18) ?? ''}"`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Quick-create shortcuts shown in empty-search states. Mirrors the
// extension popup's +Password / +App / +Note / +Entry pills so the
// dead-end of "nothing matches" turns into a one-tap path to add it
// instead. Shared pillClass factor-out keeps the four buttons visually
// identical without four copies of the same Tailwind soup.
function CreatePills() {
  const pillClass = 'inline-flex items-center gap-1 rounded-full border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/50 hover:border-emerald-600 text-emerald-100 text-xs font-semibold px-3 py-1.5 transition'
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Link href="/entries/new?type=login" className={pillClass}>
        <Plus size={13} className="text-emerald-300" />
        Password
      </Link>
      <Link href="/entries/new?type=app_login" className={pillClass}>
        <Plus size={13} className="text-emerald-300" />
        App
      </Link>
      <Link href="/notes/new" className={pillClass}>
        <Plus size={13} className="text-emerald-300" />
        Note
      </Link>
      <Link href="/entries/new" className={pillClass}>
        <Plus size={13} className="text-emerald-300" />
        Entry
      </Link>
    </div>
  )
}

// ─── File result row ──────────────────────────────────────────────────────────

function FileResultRow({ file }: { file: FileResult }) {
  const Icon = file.contentType.startsWith('image/')
    ? ImageIcon
    : file.contentType === 'application/pdf'
      ? FileText
      : FileIcon

  // Tiny per-parent-type chip so the file row reads as
  // "filename.pdf  [Note] in Cobb Trust" rather than just a bare title.
  // Color matches the section a tap will land on — yellow for notes
  // (matches the FileText note icon), blue for entries, stone for
  // category-level files.
  const parentChip = file.parentType === 'note'
    ? 'text-yellow-300 bg-yellow-950/40 border-yellow-900/50'
    : file.parentType === 'entry'
      ? 'text-blue-300 bg-blue-950/40 border-blue-900/50'
      : 'text-stone-400 bg-stone-800 border-stone-700'
  const parentLabelText = file.parentType === 'note' ? 'Note'
    : file.parentType === 'entry' ? 'Entry'
    : file.parentType === 'category' ? 'Category'
    : null

  const Body = (
    <div className="flex items-center gap-3 min-w-0">
      <Icon size={18} className="shrink-0 text-stone-400" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-stone-200 truncate">{file.filename}</div>
        <div className="text-xs text-stone-500 truncate flex items-center gap-1.5">
          {parentLabelText && (
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${parentChip}`}>
              {parentLabelText}
            </span>
          )}
          <span className="truncate">in {file.parentLabel} · {formatBytes(file.size)}</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-stone-800/60 border-stone-700/50 hover:border-stone-600 hover:bg-stone-800 transition">
      {file.parentHref ? (
        <Link href={file.parentHref} className="flex-1 min-w-0">
          {Body}
        </Link>
      ) : (
        <div className="flex-1 min-w-0">{Body}</div>
      )}
      {isPreviewable(file.contentType) && (
        <FilePreviewButton
          file={{ id: file.id, filename: file.filename, contentType: file.contentType, size: file.size }}
          className="p-1.5 rounded text-stone-500 hover:text-emerald-400 hover:bg-stone-700 transition shrink-0"
        />
      )}
      <a
        href={file.downloadHref}
        title="Download"
        className="p-1.5 rounded text-stone-500 hover:text-emerald-400 hover:bg-stone-700 transition shrink-0"
      >
        <Download size={15} />
      </a>
    </div>
  )
}

// ─── Contact result row ──────────────────────────────────────────────────────

function ContactResultRow({ contact }: { contact: ContactResult }) {
  const primaryEmail = contact.emails[0]?.value
  const primaryPhone = contact.phones[0]?.value
  const subtitle = [contact.jobTitle, contact.organization].filter(Boolean).join(' · ')

  return (
    <Link
      href={`/contacts?contact=${encodeURIComponent(contact.id)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-xl border bg-stone-800/60 border-stone-700/50 hover:border-stone-600 hover:bg-stone-800 transition"
    >
      <User size={18} className="shrink-0 text-stone-400" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-stone-200 truncate">
          {contact.displayName || '(no name)'}
        </div>
        {subtitle && (
          <div className="text-xs text-stone-500 truncate">{subtitle}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-400 mt-0.5">
          {primaryEmail && (
            <span className="inline-flex items-center gap-1 truncate min-w-0">
              <Mail size={11} className="shrink-0 text-stone-500" />
              <span className="truncate">{primaryEmail}</span>
            </span>
          )}
          {primaryPhone && (
            <span className="inline-flex items-center gap-1">
              <Phone size={11} className="shrink-0 text-stone-500" />
              {primaryPhone}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ─── Horizontal row card ──────────────────────────────────────────────────────

interface RowProps {
  entry: Entry
  selectMode: boolean
  selected: boolean
  isMaster: boolean
  onToggle: (id: string) => void
  onPickMaster: (id: string) => void
}

function SearchEntryRow({ entry, selectMode, selected, isMaster, onToggle, onPickMaster }: RowProps) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const secret =
    entry.password ||
    entry.accountNumber ||
    (entry.type === 'credit_card' ? entry.cardNumber : null) ||
    (entry.type === 'identity' ? entry.ssn : null) ||
    null

  async function handleReveal(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!secret) return
    try { await navigator.clipboard.writeText(secret) } catch {}
    setCopied(true)
    setRevealed(true)
    setTimeout(() => { setCopied(false); setRevealed(false) }, 3000)
  }

  const date = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : ''

  const Body = (
    <>
      {/* Top line: type + date */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-stone-400">{formatEntryType(entry.type)}</span>
        <span className="text-stone-600">{date}</span>
      </div>

      {/* Title — line-clamp-2 + break-words so long titles wrap to two lines
          instead of either one truncated line or breaking per character. */}
      <div className="flex items-start gap-2 mt-0.5 flex-wrap">
        <span className="text-sm font-semibold text-stone-200 leading-snug line-clamp-2 break-words min-w-0">{entry.title}</span>
        {/* "N logins" pill removed (v295) — Lance flagged it as
            annoying once a master swallowed enough merged children that
            the chip became visual noise rather than useful signal.
            linkedCount still flows through searchVault for any future
            caller that wants it; we just stopped rendering it here. */}
        {/* Paperclip pill — surfaces attachment count so the row reads
            as a quick at-a-glance inventory of attached docs. */}
        {(entry.attachmentCount ?? 0) > 0 && (
          <span
            title={`${entry.attachmentCount} attachment${entry.attachmentCount === 1 ? '' : 's'}`}
            className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-sky-900/40 border border-sky-700/40 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 leading-none mt-0.5"
          >
            <Paperclip size={9} />
            {entry.attachmentCount}
          </span>
        )}
      </div>

      {/* Bottom line: username + secret */}
      <div className="flex items-center gap-3 text-xs mt-1 min-w-0">
        <span className="text-stone-400 truncate min-w-0 flex-1">
          {entry.username || <span className="text-stone-600">no username</span>}
        </span>
        <span className="font-mono text-emerald-300 truncate min-w-0 flex-1">
          {secret ? (revealed ? secret : '••••••••') : <span className="text-stone-600">no secret</span>}
        </span>
      </div>
    </>
  )

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2 rounded-xl border transition',
        selected
          ? isMaster
            ? 'bg-amber-950/40 border-amber-500/70 ring-1 ring-amber-500/40'
            : 'bg-amber-950/20 border-amber-700/50'
          : 'bg-stone-800/60 border-stone-700/50 hover:border-stone-600 hover:bg-stone-800'
      )}
    >
      {/* Select checkbox */}
      {selectMode && (
        <button
          type="button"
          onClick={() => onToggle(entry.id)}
          className="shrink-0"
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          <span
            className={clsx(
              'flex items-center justify-center w-5 h-5 rounded border transition',
              selected ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-600 hover:border-stone-400'
            )}
          >
            {selected && <Check size={13} />}
          </span>
        </button>
      )}

      {/* Master radio (only when selected) */}
      {selectMode && selected && (
        <button
          type="button"
          onClick={() => onPickMaster(entry.id)}
          title={isMaster ? 'This is the master' : 'Make this the master'}
          className={clsx(
            'shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 transition',
            isMaster ? 'border-amber-400 bg-amber-500/30' : 'border-stone-600 hover:border-amber-400'
          )}
        >
          {isMaster && <span className="w-2 h-2 rounded-full bg-amber-300" />}
        </button>
      )}

      {/* Content — a real <Link>, not a <div onClick>. Native anchor clicks
          are what mobile browsers expect; using onClick on a div was
          fragile (taps got eaten when the on-screen keyboard was up, or
          dropped when a state update remounted the wrapper). The parent
          results container blurs the input on touchstart so the keyboard
          dismisses cleanly before the link click resolves. */}
      {selectMode ? (
        <button
          type="button"
          className="flex-1 min-w-0 cursor-pointer text-left"
          onClick={() => onToggle(entry.id)}
        >
          {Body}
        </button>
      ) : (
        <Link
          href={`/entries/${entry.id}`}
          className="flex-1 min-w-0 cursor-pointer"
        >
          {Body}
        </Link>
      )}

      {/* Actions (hidden in select mode) */}
      {!selectMode && (
        <div className="flex items-center gap-1 shrink-0">
          {secret && (
            <button
              type="button"
              onClick={handleReveal}
              title={copied ? 'Copied!' : 'Reveal & copy'}
              className={clsx(
                'p-1.5 rounded transition',
                copied ? 'text-emerald-400' : 'text-stone-500 hover:text-stone-200'
              )}
            >
              {copied ? <Check size={15} /> : <Eye size={15} />}
            </button>
          )}
          <Link
            href={`/entries/${entry.id}/edit`}
            title="Edit"
            aria-label="Edit"
            className="p-1.5 rounded text-stone-500 hover:text-stone-200 transition"
          >
            <Pencil size={15} />
          </Link>
        </div>
      )}
    </div>
  )
}
