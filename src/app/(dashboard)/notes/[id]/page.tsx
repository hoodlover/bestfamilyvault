import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notes, categories, files, noteFavorites } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { ChevronRight, Star, Pencil, Play, Paperclip } from 'lucide-react'
import { DeleteNoteButton } from '@/components/ui/delete-note-button'
import { FileList } from '@/components/ui/file-list'
import { FileUpload } from '@/components/ui/file-upload'
import { LinkifiedText } from '@/components/ui/linkified-text'
import { CopyButton } from '@/components/ui/copy-button'
import { RichTextDisplay } from '@/components/ui/rich-text-display'
import { AddToMealPlanButton } from '@/components/ui/add-to-meal-plan-button'
import { decryptNote } from '@/lib/crypto'
import { abbreviateRecipeTag } from '@/lib/recipe-tag-abbrev'
import { HelpPopout } from '@/components/ui/help-popout'
import { SmartRecipeIcon } from '@/components/ui/smart-recipe-icon'
import { guideRouteForSlug, isGuideSlug, LETTER_TAG } from '@/lib/dead-now-what-config'
import { cleanGuideContentForReading, paragraphsOf } from '@/lib/guide-reading'
import { ReminderControl } from '@/components/ui/reminder-control'
import { listRemindersForNote } from '@/lib/actions/reminders'

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect('/login')
  const isSuperuser = session.user.role === 'superuser'
  const isReadonly = session.user.role === 'readonly'

  const rawNote = await db
    .select()
    .from(notes)
    .where(eq(notes.id, id))
    .then((r) => r[0])

  if (!rawNote) notFound()
  if (rawNote.isPrivate && !isSuperuser) redirect('/dashboard')
  // isPersonal is strictly owner-only (superuser does not bypass).
  if (rawNote.isPersonal && rawNote.createdBy !== session.user.id) {
    redirect('/dashboard')
  }

  const note = decryptNote(rawNote)

  const category = note.categoryId
    ? await db.select().from(categories).where(eq(categories.id, note.categoryId)).then((r) => r[0])
    : null

  const attachedFiles = await db.select().from(files).where(eq(files.noteId, note.id))
  // Per-user star.
  const userFavorited = await db
    .select({ id: noteFavorites.id })
    .from(noteFavorites)
    .where(and(eq(noteFavorites.userId, session.user.id), eq(noteFavorites.noteId, id)))
    .then((r) => r.length > 0)
  const canEdit = !isReadonly
  // Reminders the user has set on this note. Hide the control for
  // read-only roles since they can't create new ones anyway.
  const noteReminders = canEdit ? await listRemindersForNote(note.id) : []
  const categoryHref = category ? guideRouteForSlug(category.slug) ?? `/categories/${category.slug}` : null
  const isDeadNowWhatNote = category ? isGuideSlug(category.slug) : false
  const readableContent = isDeadNowWhatNote ? cleanGuideContentForReading(note.content) : note.content
  const isLetter = isDeadNowWhatNote && (note.tags?.includes(LETTER_TAG) ?? false)

  return (
    <div className="px-4 py-6 md:p-8 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-6">
        <Link href="/notes" className="hover:text-stone-300 transition">Notes</Link>
        {category && (
          <>
            <ChevronRight size={14} />
            <Link href={categoryHref ?? '/notes'} className="hover:text-stone-300 transition">{category.name}</Link>
          </>
        )}
        <ChevronRight size={14} />
        <span className="text-stone-300 truncate max-w-[200px]">{note.title}</span>
      </nav>

      {/* Header — stacks on mobile so a long note title gets full width
          before competing with the Edit/Delete buttons. */}
      <div className="flex flex-col gap-3 mb-6 md:mb-8 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {/* Same SmartRecipeIcon used on the recipes list — gives the
              detail page a real food photo (Pexels) when one's
              available, otherwise the Claude-picked illustrated PNG,
              otherwise the keyword fallback. object-cover so the photo
              fills the rounded square cleanly. */}
          {category?.slug === 'recipes' && (
            <SmartRecipeIcon
              title={note.title}
              tags={note.tags ?? []}
              width={64}
              height={64}
              className="h-16 w-16 object-cover rounded-xl shrink-0 shadow-md"
            />
          )}
          <h1 className="text-xl md:text-2xl font-bold text-stone-100 leading-tight break-words min-w-0">{note.title}</h1>
          {category?.slug === 'recipes' && (
            <HelpPopout
              title="Recipe"
              sections={[
                {
                  heading: 'Cook with it',
                  tips: [
                    { title: 'Start recipe', description: 'Full-screen black cooking mode. Huge step text, prev/next, per-step 🔊 reads it aloud. Keeps your phone screen on while cooking.' },
                    { title: 'Step splitter', description: 'Claude Haiku splits the method into discrete steps the first time you start cooking. Cached locally so repeat cooks are instant.' },
                  ],
                },
                {
                  heading: 'Plan with it',
                  tips: [
                    { title: 'Add to meal plan', description: 'Drops the recipe into this week\'s plan at ×1. Ingredients merge into the auto shopping list.' },
                    { title: 'Edit', description: 'Structured editor — title, subcategory chips, ingredient list (one per line), method, story, servings.' },
                  ],
                },
                {
                  heading: 'Tags + servings',
                  tips: [
                    { title: 'Abbrev pills', description: 'Three-letter pills next to Serves N show every recipe-type subcategory this recipe belongs to (hover for full name).' },
                    { title: 'Servings', description: 'Used by the meal-plan scaler — "1×" means this many; "2×" doubles every ingredient on the shopping list.' },
                  ],
                },
                {
                  heading: 'Attachments',
                  tips: [
                    { title: 'Auto-named files', description: 'Uploads get the recipe title + date as the filename (recipe-name-2024-08-15.jpg). Photos use EXIF capture date.' },
                    { title: 'Rename inline', description: 'Pencil icon on each attachment lets you fix the name in place.' },
                  ],
                },
              ]}
            />
          )}
          {userFavorited && <Star size={18} className="text-[#d8a531] fill-[#d8a531] shrink-0" />}
          {note.isPrivate && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 px-2 py-0.5 rounded-full">
              <img src="/icons/cobb/privatevault.png" width={10} height={10} alt="" className="object-contain opacity-80" /> Private
            </span>
          )}
          {/* Attachment count chip — same sky-tinted Paperclip pill the
              EntryCard / entry detail page uses, so a note with files
              attached is recognizable at a glance even when opened. */}
          {attachedFiles.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 rounded-full px-2 py-0.5"
              title={`${attachedFiles.length} attachment${attachedFiles.length === 1 ? '' : 's'}`}
            >
              <Paperclip size={11} />
              {attachedFiles.length}
            </span>
          )}
          {/* Soft theme pill set — category name, Serves N, and the
              recipe-type abbrev pills all wear the same accent recipe
              as the Back-to-plan button so the meta line carries a
              uniform color cue. */}
          {category && (
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
              style={{
                backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                color: 'rgb(var(--accent-200))',
                boxShadow: '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 8px rgb(var(--accent-500) / 0.18)',
              }}
            >
              {category.name}
            </span>
          )}
          {note.servings != null && category?.slug === 'recipes' && (
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
              style={{
                backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                color: 'rgb(var(--accent-200))',
                boxShadow: '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 8px rgb(var(--accent-500) / 0.18)',
              }}
            >
              Serves {note.servings}
            </span>
          )}
          {category?.slug === 'recipes' && (note.tags ?? []).slice(0, 8).map((t) => (
            <span
              key={t}
              title={t}
              className="font-mono text-[11px] font-semibold tracking-wider px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                color: 'rgb(var(--accent-200))',
                boxShadow: '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 8px rgb(var(--accent-500) / 0.18)',
              }}
            >
              {abbreviateRecipeTag(t)}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap md:shrink-0">
          {/* Cooking mode is read-only — even read-only users can start it. */}
          {category?.slug === 'recipes' && (
            <Link
              href={`/notes/${note.id}/cook`}
              // Soft theme pill — matches the AddToMealPlanButton + the
              // meta pills on the same row so the whole action group
              // reads as one consistent button family.
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition"
              style={{
                backgroundColor: 'rgb(var(--accent-700) / 0.18)',
                color: 'rgb(var(--accent-200))',
                boxShadow: '0 0 0 1px rgb(var(--accent-500) / 0.4), 0 2px 10px rgb(var(--accent-500) / 0.2)',
              }}
            >
              <Play size={13} />
              Start recipe
            </Link>
          )}
          {canEdit && (
            <>
              {category?.slug === 'recipes' && (
                <AddToMealPlanButton recipeId={note.id} />
              )}
              <Link
                href={`/notes/${note.id}/edit`}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 hover:text-stone-100 text-sm rounded-lg transition"
              >
                <Pencil size={13} />
                Edit
              </Link>
              <DeleteNoteButton id={note.id} />
            </>
          )}
        </div>
      </div>

      {/* Content. Three render paths:
           - IDNW letter: paragraph-flow via paragraphsOf for mobile-friendly wrapping
           - Other IDNW notes: whitespace-pre-wrap so structured guide copy stays put
           - Everything else: Tiptap RichTextDisplay renders B/U/highlight/lists/checkboxes
             from HTML, and falls back gracefully for plain-text legacy notes. */}
      <div className="bg-stone-800/60 border border-stone-700/50 rounded-2xl p-4 md:p-6 mb-6 relative">
        {readableContent ? (
          <>
            <div className="absolute top-3 right-3">
              <CopyButton text={readableContent} label="Copy note text" />
            </div>
            {isLetter ? (
              <div className="text-stone-300 text-sm leading-relaxed break-words pr-12 sm:pr-20 space-y-3">
                {paragraphsOf(readableContent).map((para, i) => (
                  <p key={i}>
                    <LinkifiedText text={para} />
                  </p>
                ))}
              </div>
            ) : isDeadNowWhatNote ? (
              <div className="text-stone-300 text-sm leading-relaxed whitespace-pre-wrap break-words pr-12 sm:pr-20">
                <LinkifiedText text={readableContent} />
              </div>
            ) : (
              <div className="text-stone-300 text-sm leading-relaxed break-words pr-12 sm:pr-20">
                <RichTextDisplay content={readableContent} />
              </div>
            )}
          </>
        ) : (
          <p className="text-stone-600 italic text-sm">No content.</p>
        )}
      </div>

      {canEdit && (
        <div className="mb-6">
          <ReminderControl
            noteId={note.id}
            defaultTitle={note.title}
            initialReminders={noteReminders.map((r) => ({
              id: r.id,
              title: r.title,
              body: r.body,
              remindAt: r.remindAt,
              sentAt: r.sentAt,
            }))}
          />
        </div>
      )}

      {/* Files */}
      {attachedFiles.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">Attachments</h2>
          <FileList files={attachedFiles} canDelete={canEdit} />
        </div>
      )}

      {/* Upload */}
      {canEdit && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wider mb-3">Add Attachment</h2>
          <FileUpload noteId={note.id} isPrivate={note.isPrivate} />
        </div>
      )}

      <div className="text-xs text-stone-600">
        Created {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''} ·
        Last updated {note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : ''}
      </div>
    </div>
  )
}
