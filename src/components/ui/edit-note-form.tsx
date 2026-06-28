'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateNote } from '@/lib/actions/entries'
import { titleCaseWords } from '@/lib/title-case'
import type { InferSelectModel } from 'drizzle-orm'
import type { notes, categories } from '@/lib/db/schema'
import { useFormAutosave, formatSavedAt } from './use-form-autosave'
import { RichTextEditor } from './rich-text-editor'

type Note = InferSelectModel<typeof notes>
type Category = InferSelectModel<typeof categories>

interface SubcategoryOption { id: string; name: string; parentSubcategoryId?: string | null }

export function EditNoteForm({
  note,
  categories,
  isSuperuser,
  userFavorited = false,
  recipeSubcategories = [],
  isRecipe = false,
}: {
  note: Note
  categories: Category[]
  isSuperuser: boolean
  /** Per-user favorite state — controls the Favorite checkbox default. */
  userFavorited?: boolean
  /**
   * Canonical recipe subcategories (Slow Cooker, Soup, etc.). Only
   * passed when this note is in the Recipes category — the form then
   * hides the category dropdown (it's always Recipes) and shows a
   * checkbox multi-select instead.
   */
  recipeSubcategories?: SubcategoryOption[]
  isRecipe?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = useCallback((fd: FormData) => updateNote(note.id, fd), [note.id])
  const isErr = useCallback((r: { error?: string } | undefined) => !!r?.error, [])
  const { formRef, dirty, lastSavedAt, onFormChange, markClean } = useFormAutosave({
    save,
    isError: isErr,
  })

  // Selected recipe-subcategory IDs (multi-select). Pre-filled from
  // notes.tags by matching tag NAMES back to subcategory IDs — that's
  // how the data is stored (tags array of names, subcategoryId as
  // primary). Empty when this isn't a recipe.
  const initialSubIds = isRecipe
    ? recipeSubcategories
        .filter((s) => (note.tags ?? []).includes(s.name))
        .map((s) => s.id)
    : []
  const [selectedSubIds, setSelectedSubIds] = useState<string[]>(initialSubIds)
  function toggleSub(id: string) {
    setSelectedSubIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    // The form's onChange handler also gets the change so autosave fires.
    if (formRef.current) onFormChange()
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await updateNote(note.id, formData)

    setLoading(false)

    if (result?.error) {
      setError(result.error)
    } else {
      markClean()
      setSaved(true)
      setTimeout(() => {
        router.push(`/notes/${note.id}`)
        router.refresh()
      }, 800)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onChange={onFormChange} className="space-y-5">
      {/* Quick-save header — autosave status on the left, a tappable Save
          button on the right so the user doesn't have to scroll to the
          bottom of a long note to save. */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500 flex items-center gap-1.5 min-w-0">
          {dirty ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="truncate">Unsaved — autosaves every 30s</span>
            </>
          ) : lastSavedAt ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">Auto-saved at {formatSavedAt(lastSavedAt)}</span>
            </>
          ) : (
            <span className="truncate">Changes save when you press Save.</span>
          )}
        </div>
        {/* Mobile: square save icon */}
        <button
          type="submit"
          disabled={loading || saved}
          aria-label="Save changes"
          title="Save changes"
          className="md:hidden inline-flex items-center justify-center w-12 h-12 rounded-lg disabled:opacity-50 transition active:scale-95 shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/cobb/icons/system/original_save_icon.png" alt="" className="block w-12 h-12 object-contain" />
        </button>
        {/* Desktop: wider styled button */}
        <button
          type="submit"
          disabled={loading || saved}
          className="hidden md:flex items-center gap-1.5 px-4 py-1.5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition shrink-0 self-center"
        >
          {loading ? 'Saving...' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Title *</label>
        <input
          name="title"
          required
          defaultValue={note.title}
          autoCapitalize="words"
          onBlur={(e) => { e.currentTarget.value = titleCaseWords(e.currentTarget.value) }}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      {/* Recipes always live under the Recipes category, so the cat
          dropdown is redundant — replaced with the subcategory multi-
          select. categoryId is still submitted (hidden input) so the
          server action can resolve subcategory IDs against the right
          parent category. */}
      {isRecipe && recipeSubcategories.length > 0 ? (
        <>
          <input type="hidden" name="categoryId" value={note.categoryId ?? ''} />
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
              <label className="text-sm font-medium text-stone-300">
                Recipe type
                <span className="ml-1.5 text-[11px] text-stone-500 font-normal">
                  (pick any that fit — {selectedSubIds.length} selected)
                </span>
              </label>
              {selectedSubIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelectedSubIds([]); onFormChange() }}
                  className="text-[11px] text-stone-500 hover:text-stone-300 transition"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Hidden inputs feed the form submission. Each selected
                subcategory id becomes one `tags` field, which the
                updateNote action reads via formData.getAll('tags'). */}
            {selectedSubIds.map((id) => (
              <input key={id} type="hidden" name="tags" value={id} />
            ))}
            {/* Sentinel so the server can tell "no tags" apart from
                "tags field not present" (the latter happens on
                non-recipe notes and shouldn't clobber stored tags). */}
            <input type="hidden" name="tags" value="" />
            {/* Parents in the grid; children stack inside their parent's
                cell as smaller indented chips. Mirrors RecipeForm. */}
            {(() => {
              const parents = recipeSubcategories.filter((s) => !s.parentSubcategoryId)
              const kidsByParent = new Map<string, SubcategoryOption[]>()
              for (const s of recipeSubcategories) {
                if (s.parentSubcategoryId) {
                  const arr = kidsByParent.get(s.parentSubcategoryId) ?? []
                  arr.push(s)
                  kidsByParent.set(s.parentSubcategoryId, arr)
                }
              }
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 items-start">
                  {parents.map((sub) => {
                    const checked = selectedSubIds.includes(sub.id)
                    const kids = kidsByParent.get(sub.id) ?? []
                    return (
                      <div key={sub.id} className="flex flex-col gap-1">
                        <label
                          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-sm cursor-pointer transition ${
                            checked
                              ? 'bg-emerald-700/20 border-emerald-700/60 text-emerald-200'
                              : 'bg-stone-800 border-stone-700 text-stone-300 hover:border-stone-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSub(sub.id)}
                            className="h-4 w-4 rounded border-stone-600 bg-stone-900 text-emerald-600 focus:ring-emerald-600/50 focus:ring-offset-0"
                          />
                          <span className="truncate">{sub.name}</span>
                        </label>
                        {kids.length > 0 && (
                          <div className="ml-3 flex flex-wrap gap-1">
                            {kids.map((kid) => {
                              const kchecked = selectedSubIds.includes(kid.id)
                              return (
                                <label
                                  key={kid.id}
                                  className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs cursor-pointer transition ${
                                    kchecked
                                      ? 'bg-emerald-700/20 border-emerald-700/60 text-emerald-200'
                                      : 'bg-stone-900 border-stone-700 text-stone-400 hover:border-stone-600'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={kchecked}
                                    onChange={() => toggleSub(kid.id)}
                                    className="h-3 w-3 rounded border-stone-600 bg-stone-900 text-emerald-600 focus:ring-emerald-600/50 focus:ring-offset-0"
                                  />
                                  <span className="truncate">{kid.name}</span>
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </>
      ) : (
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Category</label>
          <select
            name="categoryId"
            defaultValue={note.categoryId ?? ''}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Content</label>
        {/* onChange is critical: the rich text editor manages its content
            inside a contentEditable + mirrors to a hidden input. The
            <form onChange={onFormChange}> handler only fires for native
            <input>/<select> change events; programmatic edits to the
            hidden input don't bubble. Without this wire-up, typing in
            the body never marked the form dirty and autosave silently
            no-op'd on every autosave tick. */}
        <RichTextEditor
          name="content"
          defaultValue={note.content ?? ''}
          placeholder="Start writing…"
          onChange={onFormChange}
        />
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
          <input
            type="checkbox"
            name="isFavorite"
            value="true"
            defaultChecked={userFavorited}
            className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
          />
          Favorite
        </label>
        {isSuperuser && (
          <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
            <input
              type="checkbox"
              name="isPrivate"
              value="true"
              defaultChecked={note.isPrivate}
              className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
            />
            Private
          </label>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {saved && (
        <div className="text-sm text-green-400 bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2">
          Saved! Redirecting...
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading || saved}
          className="flex-1 py-2.5 px-4 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
        >
          {loading ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="py-2.5 px-4 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 font-medium rounded-lg transition text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
