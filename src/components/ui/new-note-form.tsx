'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createNote } from '@/lib/actions/entries'
import { titleCaseWords } from '@/lib/title-case'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import { useUnsavedGuard } from './use-unsaved-guard'
import { RichTextEditor } from './rich-text-editor'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories, subcategories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

interface Props {
  categories: Category[]
  subcategories: Subcategory[]
  isSuperuser: boolean
  defaultIsPrivate?: boolean
  defaultIsPersonal?: boolean
  defaultCategoryId?: string
}

export function NewNoteForm({ categories, subcategories, isSuperuser, defaultIsPrivate, defaultIsPersonal, defaultCategoryId }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveAndNew, setSaveAndNew] = useState(false)
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const { dirty, markDirty, markClean } = useUnsavedGuard()
  const filteredSubs = subcategories.filter((s) => s.categoryId === categoryId)
  const activeCategorySlug = categories.find((c) => c.id === categoryId)?.slug ?? ''

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await createNote(formData)

    setLoading(false)

    if (result?.error) {
      setError(result.error)
    } else if (saveAndNew) {
      ;(e.target as HTMLFormElement).reset()
      markClean()
    } else {
      markClean()
      router.push(result?.id ? `/notes/${result.id}` : '/notes')
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} onChange={markDirty} className="space-y-5">
      {dirty && (
        <div className="sticky top-0 z-10 -mx-4 md:-mx-0 px-3 py-1.5 text-xs text-amber-200 bg-amber-950/40 border-y md:border md:rounded-md border-amber-700/40 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Not saved yet — tap Save when you&rsquo;re done.
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Title *</label>
        <input
          name="title"
          required
          placeholder="Note title..."
          autoCapitalize="words"
          onBlur={(e) => { e.currentTarget.value = titleCaseWords(e.currentTarget.value) }}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Category</label>
          <select
            name="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {filteredSubs.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Subcategory</label>
            <select
              name="subcategoryId"
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            >
              <option value="">None</option>
              {filteredSubs.map((s) => (
                <option key={s.id} value={s.id}>{getSubcategoryLabel(activeCategorySlug, s.name)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Content</label>
        <RichTextEditor name="content" placeholder="Start writing…" onChange={markDirty} />
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
          <input type="checkbox" name="isFavorite" value="true" className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600" />
          Favorite
        </label>
        <label className="flex items-center gap-2 text-sm text-amber-400 cursor-pointer">
          <input type="checkbox" name="isPersonal" value="true" defaultChecked={defaultIsPersonal} className="rounded border-stone-600 bg-stone-800 text-amber-600 focus:ring-amber-600" />
          Personal (only you)
        </label>
        {isSuperuser && (
          <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
            <input type="checkbox" name="isPrivate" value="true" defaultChecked={defaultIsPrivate} className="rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600" />
            Private
          </label>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          onClick={() => setSaveAndNew(false)}
          className="flex-1 py-2.5 px-4 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 text-white font-medium rounded-lg transition"
        >
          {loading && !saveAndNew ? 'Saving...' : 'Save Note'}
        </button>
        <button
          type="submit"
          disabled={loading}
          onClick={() => setSaveAndNew(true)}
          className="py-2.5 px-4 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 font-medium rounded-lg transition text-sm"
        >
          Save & New
        </button>
      </div>
    </form>
  )
}
