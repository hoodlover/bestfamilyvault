'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, ClipboardList, CopyCheck, FilePlus2, ImagePlus, KeyRound, Link as LinkIcon, Pause, RotateCcw, Search, SkipForward, StickyNote, X } from 'lucide-react'
import { titleCaseWords } from '@/lib/title-case'
import { GUIDE_PROFILES } from '@/lib/dead-now-what-config'
import { uploadFile } from '@/lib/actions/files'
import { compressImage } from '@/lib/image-compress'

interface GuideTopic {
  id: string
  title: string
  section: string
  content: string
  tags: string[]
}

interface FillField {
  noteId: string
  topicTitle: string
  section: string
  content: string
  start: number
  end: number
  prompt: string
  context: string
  topicTag: string
  lineIndex: number
  before: string
  after: string
}

interface VaultSearchResult {
  id: string
  kind: string
  title: string
  detail: string | null
  href: string
}

export function DeadNowWhatFillWizard({ topics, profileKey }: { topics: GuideTopic[]; profileKey: string }) {
  const router = useRouter()
  const [localTopics, setLocalTopics] = useState(topics)
  const [active, setActive] = useState(false)
  const [answer, setAnswer] = useState('')
  // Optional one-line note appended to the answer in parentheses. Replaces
  // the old "context" box that just retyped the question — that was
  // redundant and took up real estate without giving the user anywhere to
  // add their own remark.
  const [answerNote, setAnswerNote] = useState('')
  const [skippedIds, setSkippedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [vaultQuery, setVaultQuery] = useState('')
  const [vaultResults, setVaultResults] = useState<VaultSearchResult[]>([])
  const [vaultSearchMessage, setVaultSearchMessage] = useState<string | null>(null)
  // Cards picked from the vault search. Each picked card appends a
  // markdown-style link to the saved answer instead of overwriting the
  // typed answer (the old behavior — a single pick blew away whatever the
  // user just typed). Multiple cards can be linked to one blank.
  const [linkedCards, setLinkedCards] = useState<VaultSearchResult[]>([])
  const [sameAsMessage, setSameAsMessage] = useState<string | null>(null)
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [cardKind, setCardKind] = useState<'note' | 'password'>('note')
  const [cardTitle, setCardTitle] = useState('')
  const [cardDetail, setCardDetail] = useState('')
  const [cardUsername, setCardUsername] = useState('')
  const [cardPassword, setCardPassword] = useState('')
  const [cardUrl, setCardUrl] = useState('')
  const [cardMessage, setCardMessage] = useState<string | null>(null)
  // Optional files attached to the new vault card. Each can be a photo
  // (compressed before upload) or any other file like a PDF / doc
  // (uploaded as-is). Multiple files upload sequentially against the
  // same freshly-created card. Previews align by index; null means
  // "not an image, show filename row instead".
  const [cardFiles, setCardFiles] = useState<File[]>([])
  const [cardFilePreviews, setCardFilePreviews] = useState<(string | null)[]>([])
  const [isPending, startTransition] = useTransition()
  // The top of the active-question card. Used to scroll back to it after
  // save/skip so the next 'type answer here' field lands at the top of
  // the viewport, not buried under the previous card's footer.
  const questionRef = useRef<HTMLDivElement | null>(null)

  function scrollToQuestionTop() {
    // Defer one frame so React commits the next-question render before
    // we scroll — otherwise we'd scroll to where the OLD question used to be.
    requestAnimationFrame(() => {
      questionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const fields = useMemo(() => findFillFields(localTopics), [localTopics])
  const field = fields.find((item) => !skippedIds.includes(fieldKey(item))) ?? null
  const done = fields.length === 0

  function saveAndNext() {
    if (!field) return
    // Allow saving when the user has linked cards even if they typed
    // nothing — picking a couple of vault cards to reference IS the answer.
    if (answer.trim() === '' && linkedCards.length === 0) return
    // Title-case the answer so "alex morgan" becomes "Alex Morgan" when the user
    // hits Save without first blurring the field. Append the optional note
    // in parentheses if the user added one — keeps it inline with the
    // answer so the saved guide reads naturally with the note inline.
    // Linked vault cards land after, separated by an em-dash, so they
    // read as "see also" rather than part of the answer string.
    const replacement = composeReplacement(answer, answerNote, linkedCards)
    const nextContent = field.content.slice(0, field.start) + replacement + field.content.slice(field.end)
    setError(null)

    startTransition(async () => {
      const result = await saveGuideContent(field.noteId, nextContent)
      if (result?.error) {
        setError(result.error)
        return
      }
      setLocalTopics((current) =>
        current.map((topic) => topic.id === field.noteId ? { ...topic, content: nextContent } : topic)
      )
      setAnswer('')
      setAnswerNote('')
      setLinkedCards([])
      setSkippedIds((current) => current.filter((id) => id !== fieldKey(field)))
      clearCardForm()
      setSavedCount((count) => count + 1)
      router.refresh()
      scrollToQuestionTop()
    })
  }

  function skipField() {
    if (!field) return
    setAnswer('')
    setAnswerNote('')
    setLinkedCards([])
    setSkippedIds((current) => [...current, fieldKey(field)])
    scrollToQuestionTop()
  }

  function searchVaultCards() {
    const query = vaultQuery.trim()
    if (query.length < 2) {
      setVaultSearchMessage('Type at least 2 characters.')
      setVaultResults([])
      return
    }
    setVaultSearchMessage('Searching...')
    startTransition(async () => {
      const result = await findVaultCards(query)
      if (result.error) {
        setVaultSearchMessage(result.error)
        setVaultResults([])
        return
      }
      setVaultResults(result.results ?? [])
      setVaultSearchMessage((result.results?.length ?? 0) === 0 ? 'No matching cards found.' : null)
    })
  }

  function chooseVaultCard(result: VaultSearchResult) {
    // Append to the linked-cards list instead of overwriting the typed
    // answer — picking a card while you've already started typing used
    // to blow the answer away. Each link is stored as the full
    // VaultSearchResult so we can show a chip and serialize it as
    // `[Title](href)` on save. LinkifiedText renders that markdown form
    // as an anchor with the title as visible text.
    setLinkedCards((current) => {
      if (current.some((card) => card.kind === result.kind && card.id === result.id)) return current
      return [...current, result]
    })
    setVaultSearchMessage(`Linked “${result.title}”. Search for more or save when ready.`)
  }

  function removeLinkedCard(kind: string, id: string) {
    setLinkedCards((current) => current.filter((card) => !(card.kind === kind && card.id === id)))
  }

  function addCardAndNext() {
    if (!field) return
    setCardMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await createCardForField(field, {
        cardKind,
        title: cardTitle,
        detail: cardDetail,
        username: cardUsername,
        password: cardPassword,
        url: cardUrl,
        linkedCards: linkedCards.map((c) => ({ title: c.title, href: c.href })),
      })
      if (result.error || !result.content) {
        setCardMessage(result.error ?? 'Could not create the card.')
        return
      }
      // If files were attached, upload each against the freshly-created
      // card. Images get compressed first; other types (PDF, doc) upload
      // as-is. Failure here is non-fatal — the card and guide-link are
      // already in place, so we collect per-file failures and surface
      // them as a single warning.
      if (cardFiles.length > 0 && result.card) {
        const failures: string[] = []
        for (const file of cardFiles) {
          try {
            const toUpload = file.type.startsWith('image/')
              ? await compressImage(file).catch(() => file)
              : file
            const fd = new FormData()
            fd.append('file', toUpload)
            if (result.card.kind === 'Password') fd.append('entryId', result.card.id)
            else fd.append('noteId', result.card.id)
            const up = await uploadFile(fd)
            if (up?.error) failures.push(`${file.name}: ${up.error}`)
          } catch (err) {
            failures.push(`${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`)
          }
        }
        if (failures.length > 0) {
          setCardMessage(`Saved the answer, but ${failures.length} file upload${failures.length === 1 ? '' : 's'} failed: ${failures.join('; ')}`)
        }
      }
      setLocalTopics((current) =>
        current.map((topic) => topic.id === field.noteId ? { ...topic, content: result.content! } : topic)
      )
      setAnswer('')
      setAnswerNote('')
      setLinkedCards([])
      setSkippedIds((current) => current.filter((id) => id !== fieldKey(field)))
      clearCardForm()
      setSavedCount((count) => count + 1)
      router.refresh()
      scrollToQuestionTop()
    })
  }

  function useOwnerAnswer() {
    if (!field) return
    setSameAsMessage('Checking owner answer...')
    startTransition(async () => {
      const result = await getLanceAnswer(field)
      if (result.error) {
        setSameAsMessage(result.error)
        return
      }
      if (!result.answer) {
        setSameAsMessage('No owner answer is filled in for this field yet.')
        return
      }
      setAnswer(result.answer)
      setSameAsMessage('Owner answer copied. Save when ready, or change it first.')
    })
  }

  function resetSkipped() {
    setSkippedIds([])
    setActive(true)
  }

  function clearCardForm() {
    setAddCardOpen(false)
    setCardKind('note')
    setCardTitle('')
    setCardDetail('')
    setCardUsername('')
    setCardPassword('')
    setCardUrl('')
    setCardMessage(null)
    cardFilePreviews.forEach((url) => { if (url) URL.revokeObjectURL(url) })
    setCardFiles([])
    setCardFilePreviews([])
  }

  function pickCardFiles(picked: FileList | null | undefined) {
    if (!picked || picked.length === 0) return
    const added = Array.from(picked)
    // Only generate previews for images. PDFs/docs render as a filename
    // row instead (the IDNW row used to be image-only; this lets you
    // attach a 1040 PDF to the tax-filing answer directly).
    const addedPreviews = added.map((file) =>
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    )
    setCardFiles((current) => [...current, ...added])
    setCardFilePreviews((current) => [...current, ...addedPreviews])
  }

  function removeCardFile(index: number) {
    const preview = cardFilePreviews[index]
    if (preview) URL.revokeObjectURL(preview)
    setCardFiles((current) => current.filter((_, i) => i !== index))
    setCardFilePreviews((current) => current.filter((_, i) => i !== index))
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4 md:p-5">
        <div className="flex items-center gap-2 text-emerald-200">
          <CheckCircle2 size={18} />
          <h2 className="font-semibold">All fill-in fields are complete</h2>
        </div>
        <p className="mt-2 text-sm text-stone-300 leading-relaxed">
          The guide no longer has underline blanks. You can still edit any section directly from its card.
        </p>
      </div>
    )
  }

  if (!active) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/15 p-4 md:p-5">
        <div className="flex items-center gap-2 text-amber-200 mb-3">
          <ClipboardList size={18} />
          <h2 className="font-semibold">Guided fill-in</h2>
        </div>
        <p className="text-sm text-stone-300 leading-relaxed">
          Answer one blank at a time. The prompt is rewritten from the nearby text so it reads like a question, and each answer saves immediately.
        </p>
        <div className="mt-4 rounded-md border border-stone-800 bg-stone-950/40 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-stone-500 mb-1">Next question</p>
          <p className="text-sm font-medium text-stone-100">{field?.prompt ?? 'Fill this field'}</p>
          <p className="text-xs text-stone-400 mt-1">{fields.length} blank{fields.length === 1 ? '' : 's'} left</p>
        </div>
        <button
          type="button"
          onClick={() => setActive(true)}
          className="mt-4 inline-flex items-center justify-center gap-2 w-full rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-sm px-4 py-2.5 transition"
        >
          Start filling blanks
          <ArrowRight size={15} />
        </button>
      </div>
    )
  }

  if (!field) {
    return (
      <div className="rounded-lg border border-sky-800/40 bg-sky-950/20 p-4 md:p-5">
        <div className="flex items-center gap-2 text-sky-200">
          <Pause size={18} />
          <h2 className="font-semibold">All visible blanks were skipped</h2>
        </div>
        <p className="mt-2 text-sm text-stone-300 leading-relaxed">
          You can restart the skipped list or stop here. Nothing is lost.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={resetSkipped}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-stone-950 font-semibold text-sm px-4 py-2.5 transition"
          >
            <RotateCcw size={15} />
            Review skipped
          </button>
          <button
            type="button"
            onClick={() => setActive(false)}
            className="rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm px-4 py-2.5 transition"
          >
            Stop
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={questionRef} className="scroll-mt-20 rounded-lg border border-amber-800/40 bg-amber-950/15 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-amber-300">{field.section}</p>
          <h2 className="text-lg font-semibold text-stone-100 mt-1">{field.topicTitle}</h2>
        </div>
        <span className="rounded-full border border-stone-700 bg-stone-950/50 px-2 py-1 text-xs text-stone-400">
          {fields.length} left
        </span>
      </div>

      <label className="block text-sm font-medium text-stone-200 mb-2" htmlFor="guide-fill-answer">
        {field.prompt}
      </label>
      <input
        id="guide-fill-answer"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') saveAndNext()
        }}
        onBlur={(event) => setAnswer(titleCaseWords(event.currentTarget.value))}
        autoCapitalize="words"
        disabled={isPending}
        autoFocus
        className="w-full rounded-lg border border-stone-600 bg-stone-900 px-3 py-2.5 text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
        placeholder="Type the answer here..."
      />
      {/* Slim optional note line. Replaces the old context box that just
          retyped the question. If the user fills it in, it gets appended
          to the saved answer in parentheses. */}
      <input
        id="guide-fill-note"
        value={answerNote}
        onChange={(event) => setAnswerNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') saveAndNext()
        }}
        disabled={isPending}
        className="mt-2 w-full rounded-lg border border-stone-700/60 bg-stone-900/60 px-3 py-1.5 text-sm text-stone-200 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/70 transition"
        placeholder="Optional note (added in parentheses after the answer)"
      />

      {profileKey !== GUIDE_PROFILES[0]?.key && (
        <div className="mt-3">
          <button
            type="button"
            onClick={useOwnerAnswer}
            disabled={isPending || !field.topicTag}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-800/50 bg-emerald-950/30 hover:bg-emerald-950/50 disabled:opacity-60 text-emerald-100 text-sm px-3 py-2 transition"
          >
            <CopyCheck size={15} />
            Use owner&rsquo;s answer if available
          </button>
          {sameAsMessage && <p className="mt-2 text-xs text-stone-400">{sameAsMessage}</p>}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-stone-800 bg-stone-950/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-200">
            <FilePlus2 size={15} className="text-amber-300" />
            Save a new entry or note (and attach a file)
          </div>
          <button
            type="button"
            onClick={() => setAddCardOpen((open) => !open)}
            disabled={isPending}
            className="rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-60 text-stone-200 text-xs px-3 py-1.5 transition"
          >
            {addCardOpen ? 'Close' : 'New + attach'}
          </button>
        </div>

        {addCardOpen && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCardKind('note')}
                disabled={isPending}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  cardKind === 'note'
                    ? 'border-amber-500/70 bg-amber-950/30 text-amber-100'
                    : 'border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800'
                }`}
              >
                <StickyNote size={14} />
                Note
              </button>
              <button
                type="button"
                onClick={() => setCardKind('password')}
                disabled={isPending}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  cardKind === 'password'
                    ? 'border-amber-500/70 bg-amber-950/30 text-amber-100'
                    : 'border-stone-700 bg-stone-900 text-stone-300 hover:bg-stone-800'
                }`}
              >
                <KeyRound size={14} />
                Password
              </button>
            </div>
            <input
              value={cardTitle}
              onChange={(event) => setCardTitle(event.target.value)}
              disabled={isPending}
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
              placeholder={cardKind === 'password' ? 'Card title, like Google Account' : 'Card title'}
            />
            {cardKind === 'password' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={cardUsername}
                  onChange={(event) => setCardUsername(event.target.value)}
                  disabled={isPending}
                  className="min-w-0 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
                  placeholder="Username or email"
                />
                <input
                  value={cardPassword}
                  onChange={(event) => setCardPassword(event.target.value)}
                  disabled={isPending}
                  className="min-w-0 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
                  placeholder="Password"
                />
                <input
                  value={cardUrl}
                  onChange={(event) => setCardUrl(event.target.value)}
                  disabled={isPending}
                  className="min-w-0 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition sm:col-span-2"
                  placeholder="Website, if there is one"
                />
              </div>
            )}
            <textarea
              value={cardDetail}
              onChange={(event) => setCardDetail(event.target.value)}
              disabled={isPending}
              rows={3}
              className="w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
              placeholder={cardKind === 'password' ? 'Any notes for this login...' : 'Write the note here...'}
            />

            {/* Optional attachments — photos, PDFs, or docs. Each is
                compressed if it's an image; uploaded as-is otherwise.
                Multiple files can be added in one or several picks; the
                Attach control stays visible so you can keep adding. */}
            {cardFiles.length > 0 && (
              <div className="space-y-2">
                {cardFiles.map((file, index) => {
                  const preview = cardFilePreviews[index]
                  const isImage = file.type.startsWith('image/')
                  return isImage && preview ? (
                    <div key={index} className="relative rounded-lg overflow-hidden border border-stone-700/60 bg-stone-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview} alt="" className="block w-full max-h-48 object-contain bg-black" />
                      <button
                        type="button"
                        onClick={() => removeCardFile(index)}
                        disabled={isPending}
                        aria-label="Remove file"
                        title="Remove file"
                        className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-7 w-7 rounded-full bg-stone-900/80 hover:bg-stone-800 text-stone-200 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div key={index} className="flex items-center gap-3 rounded-lg border border-stone-700/60 bg-stone-900 px-3 py-2.5">
                      <FilePlus2 size={16} className="text-amber-300 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-stone-100 truncate">{file.name}</div>
                        <div className="text-xs text-stone-500">
                          {(file.size / 1024).toFixed(0)} KB · {file.type || 'file'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeCardFile(index)}
                        disabled={isPending}
                        aria-label="Remove file"
                        title="Remove file"
                        className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-200 transition"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-stone-700 hover:border-amber-500/60 bg-stone-900/40 hover:bg-stone-900/60 text-stone-400 hover:text-amber-200 text-xs px-3 py-2.5 cursor-pointer transition">
              <ImagePlus size={14} />
              {cardFiles.length > 0
                ? `Attach more (${cardFiles.length} added)`
                : 'Attach files (photo, PDF, doc — optional)'}
              <input
                type="file"
                multiple
                /* Accept any file. The IDNW flow often needs users to
                   attach a 2025 1040 PDF to the "latest tax filing" answer;
                   the old image-only restriction made that impossible.
                   Multi-select so he can drop a couple docs in one go. */
                className="hidden"
                onChange={(event) => {
                  pickCardFiles(event.target.files)
                  event.currentTarget.value = ''
                }}
                disabled={isPending}
              />
            </label>

            {cardMessage && <p className="text-xs text-red-300">{cardMessage}</p>}
            <button
              type="button"
              onClick={addCardAndNext}
              disabled={isPending || cardTitle.trim() === ''}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-stone-950 font-semibold text-sm px-4 py-2.5 transition"
            >
              {isPending ? 'Creating...' : 'Create, link, and next'}
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-stone-800 bg-stone-950/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-stone-200 mb-2">
          <LinkIcon size={15} className="text-amber-300" />
          Link existing entries, notes, or files
        </div>
        {linkedCards.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {linkedCards.map((card) => (
              <span
                key={`${card.kind}:${card.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-700/50 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-100"
              >
                <span className="truncate max-w-[14rem]">{card.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-amber-300/80">{card.kind}</span>
                <button
                  type="button"
                  onClick={() => removeLinkedCard(card.kind, card.id)}
                  disabled={isPending}
                  aria-label={`Unlink ${card.title}`}
                  title="Unlink"
                  className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-amber-800/40 text-amber-200 transition"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={vaultQuery}
            onChange={(event) => setVaultQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                searchVaultCards()
              }
            }}
            disabled={isPending}
            className="min-w-0 rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition"
            placeholder="Search entries, notes, attached files…"
          />
          <button
            type="button"
            onClick={searchVaultCards}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-60 text-stone-200 px-3 py-2 transition"
            aria-label="Search vault"
            title="Search vault"
          >
            <Search size={16} />
          </button>
        </div>
        {vaultSearchMessage && (
          <p className="mt-2 text-xs text-stone-400">{vaultSearchMessage}</p>
        )}
        {vaultResults.length > 0 && (
          <div className="mt-3 max-h-56 overflow-y-auto divide-y divide-stone-800 rounded-lg border border-stone-800">
            {vaultResults.map((result) => (
              <button
                key={`${result.kind}:${result.id}`}
                type="button"
                onClick={() => chooseVaultCard(result)}
                className="w-full text-left p-3 bg-stone-900/70 hover:bg-stone-800 transition"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-stone-100 truncate">{result.title}</span>
                    {result.detail && <span className="block text-xs text-stone-500 truncate mt-0.5">{result.detail}</span>}
                  </span>
                  <span className="shrink-0 rounded-full border border-stone-700 px-2 py-0.5 text-[11px] text-amber-200">
                    {result.kind}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-300 bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {savedCount > 0 && !error && (
        <p className="mt-3 text-xs text-emerald-300">{savedCount} answer{savedCount === 1 ? '' : 's'} saved this session.</p>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
        <button
          type="button"
          onClick={saveAndNext}
          disabled={isPending || (answer.trim() === '' && linkedCards.length === 0)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-stone-950 font-semibold text-sm px-4 py-2.5 transition"
        >
          {isPending ? 'Saving...' : 'Save and next'}
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          onClick={skipField}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-60 text-stone-200 text-sm px-4 py-2.5 transition"
        >
          <SkipForward size={15} />
          Skip
        </button>
        <button
          type="button"
          onClick={() => setActive(false)}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-700 bg-stone-900 hover:bg-stone-800 disabled:opacity-60 text-stone-300 text-sm px-4 py-2.5 transition"
        >
          <Pause size={15} />
          Stop
        </button>
      </div>
    </div>
  )
}

function findFillFields(topics: GuideTopic[]): FillField[] {
  return topics.flatMap((topic) => {
    const fields: FillField[] = []
    const matches = topic.content.matchAll(/_{3,}/g)
    const topicTag = topic.tags.find((tag) => tag.startsWith('now-what:') && tag !== 'now-what:letter') ?? ''
    for (const match of matches) {
      const start = match.index ?? 0
      const end = start + match[0].length
      const info = getLineInfo(topic.content, start, end)
      fields.push({
        noteId: topic.id,
        topicTitle: topic.title,
        section: topic.section,
        content: topic.content,
        start,
        end,
        prompt: promptForBlank(topic.content, start, end),
        context: contextForBlank(topic.content, start, end),
        topicTag,
        lineIndex: info.lineIndex,
        before: info.before,
        after: info.after,
      })
    }
    return fields
  })
}

function promptForBlank(content: string, start: number, end: number): string {
  const info = getLineInfo(content, start, end)
  const directLabel = cleanPrompt(info.before) || cleanPrompt(info.after)
  const nearbyHeading = findNearestHeading(content, info.lineStart)

  if (directLabel) return makeQuestion(directLabel)
  if (nearbyHeading) return makeQuestion(`Add an answer for ${nearbyHeading}`)
  return 'What should go here?'
}

function contextForBlank(content: string, start: number, end: number): string {
  const info = getLineInfo(content, start, end)
  const currentLine = info.line.replace(/_{3,}/g, '[answer goes here]').trim()
  const heading = findNearestHeading(content, info.lineStart)
  if (!heading || currentLine.toLowerCase().includes(heading.toLowerCase())) return currentLine
  return `${heading}: ${currentLine}`
}

function cleanPrompt(value: string): string {
  return value
    .replace(/["]/g, '')
    .replace(/\([^\)]*$/, '')
    .replace(/^\s*(?:[-*]|[0-9]+[.)]|[—–-])\s*/, '')
    .replace(/\s*(?:[:=]|->|-)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function makeQuestion(label: string): string {
  const normalized = label
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\s+#\s*/g, ' number ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return 'What should go here?'
  if (normalized.endsWith('?')) return normalized

  const lower = normalized.toLowerCase()
  if (/^(who|what|where|when|why|how|is|are|do|does|did|should|will|can)\b/.test(lower)) {
    return `${normalized}?`
  }
  if (lower.includes('phone') || lower.includes('number') || lower.includes('policy') || lower.includes('account')) {
    return `What is the ${lower}?`
  }
  if (lower.includes('date') || lower.includes('year')) {
    return `What is the ${lower}?`
  }
  if (lower.includes('location') || lower.startsWith('where')) {
    return `Where is ${lower.replace(/^where\s+/, '')}?`
  }
  if (lower.includes('contact') || lower.includes('agent') || lower.includes('doctor') || lower.includes('lawyer')) {
    return `Who is the ${lower}?`
  }
  if (lower.startsWith('add an answer for')) return `${normalized}?`
  return `What should be entered for ${lower}?`
}

function getLineInfo(content: string, start: number, end: number) {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1
  const lineEndRaw = content.indexOf('\n', end)
  const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw
  const line = content.slice(lineStart, lineEnd)
  const localStart = start - lineStart
  const localEnd = end - lineStart
  return {
    line,
    lineStart,
    lineIndex: content.slice(0, lineStart).split('\n').length - 1,
    before: line.slice(0, localStart),
    after: line.slice(localEnd),
  }
}

function findNearestHeading(content: string, lineStart: number): string {
  const before = content.slice(0, lineStart).split('\n').map((line) => line.trim()).filter(Boolean)
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const line = before[i]
    const cleaned = cleanPrompt(line)
    if (!cleaned || cleaned.includes('__________')) continue
    if (isHeadingLine(line) || i === before.length - 1) return cleaned.toLowerCase()
  }
  return ''
}

function isHeadingLine(line: string): boolean {
  const stripped = line.replace(/[:\s]+$/, '')
  return stripped.length > 2 && stripped.length < 80 && stripped === stripped.toUpperCase()
}

function fieldKey(field: FillField): string {
  return `${field.noteId}:${field.start}:${field.end}:${field.prompt}`
}

// Build the string we splice into the guide for one blank. Order is:
// title-cased answer, optional note in parens, then any linked vault
// cards as markdown links after an em-dash. Any piece may be empty —
// links-only ("[Card](href)") and answer-only ("Alex Morgan") both
// render cleanly without dangling separators.
function composeReplacement(
  answer: string,
  note: string,
  linkedCards: { title: string; href: string }[],
): string {
  const trimmedAnswer = titleCaseWords(answer.trim())
  const trimmedNote = note.trim()
  const head = trimmedNote ? `${trimmedAnswer} (${trimmedNote})`.trim() : trimmedAnswer
  if (linkedCards.length === 0) return head
  const links = linkedCards.map((c) => `[${c.title}](${c.href})`).join(', ')
  return head ? `${head} — ${links}` : links
}

async function saveGuideContent(noteId: string, content: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const response = await fetch('/api/now-what/fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, content }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { error: data.error ?? 'Could not save this answer.' }
    return data
  } catch {
    return { error: 'Could not reach the vault. Try again in a moment.' }
  }
}

async function findVaultCards(query: string): Promise<{ results?: VaultSearchResult[]; error?: string }> {
  try {
    const response = await fetch(`/api/now-what/search?q=${encodeURIComponent(query)}`)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { error: data.error ?? 'Could not search the vault.' }
    return { results: data.results ?? [] }
  } catch {
    return { error: 'Could not search the vault. Try again in a moment.' }
  }
}

async function getLanceAnswer(field: FillField): Promise<{ answer?: string | null; error?: string }> {
  try {
    const response = await fetch('/api/now-what/same-as-lance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicTag: field.topicTag,
        lineIndex: field.lineIndex,
        before: field.before,
        after: field.after,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { error: data.error ?? 'Could not check owner answer.' }
    return { answer: data.answer ?? null }
  } catch {
    return { error: 'Could not check owner answer. Try again in a moment.' }
  }
}

interface CreatedCard { id: string; title: string; href: string; kind: 'Note' | 'Password' }

async function createCardForField(
  field: FillField,
  card: {
    cardKind: 'note' | 'password'
    title: string
    detail: string
    username: string
    password: string
    url: string
    linkedCards: { title: string; href: string }[]
  }
): Promise<{ success?: boolean; content?: string; card?: CreatedCard; error?: string }> {
  try {
    const response = await fetch('/api/now-what/add-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteId: field.noteId,
        start: field.start,
        end: field.end,
        ...card,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) return { error: data.error ?? 'Could not create the card.' }
    return { success: true, content: data.content, card: data.card }
  } catch {
    return { error: 'Could not reach the vault. Try again in a moment.' }
  }
}
