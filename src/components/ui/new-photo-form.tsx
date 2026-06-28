'use client'

// Quick-capture form behind /photo/new. Opens the camera immediately on
// mount; once a frame is captured the form swaps to a small preview +
// title + optional category/subcategory + Save. Save creates a note via
// createNote, then attaches the photo via uploadFile. On success the
// browser navigates to the new note.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Save, Camera, ScanLine, X } from 'lucide-react'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories, subcategories } from '@/lib/db/schema'
import { createNote } from '@/lib/actions/entries'
import { uploadFile } from '@/lib/actions/files'
import { compressImage } from '@/lib/image-compress'
import { titleCaseWords } from '@/lib/title-case'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import { CameraCapture } from './camera-capture'
import { DocScannerEditor } from './doc-scanner-editor'

type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

interface Props {
  categories: Category[]
  subcategories: Subcategory[]
  isSuperuser: boolean
}

export function NewPhotoForm({ categories, subcategories, isSuperuser }: Props) {
  const router = useRouter()
  const [cameraOpen, setCameraOpen] = useState(true)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [subcategoryId, setSubcategoryId] = useState<string>('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredSubs = useMemo(
    () => subcategories.filter((s) => s.categoryId === categoryId),
    [subcategories, categoryId],
  )
  const activeCategorySlug = categories.find((c) => c.id === categoryId)?.slug ?? ''

  // Revoke blob URLs when we replace or unmount, otherwise the browser
  // holds the bytes forever.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
    }
  }, [photoPreview])

  async function handleCapture(file: File) {
    setError(null)
    setCameraOpen(false)
    // Run through the same compressor the upload flow uses so the photo
    // lands as a sub-megabyte JPEG ready for upload.
    try {
      const compressed = await compressImage(file)
      setPhoto(compressed)
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setPhotoPreview(URL.createObjectURL(compressed))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process photo.')
    }
  }

  function discardPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(null)
    setPhotoPreview(null)
    setCameraOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!photo) return
    if (!title.trim()) {
      setError('Give it a title before saving.')
      return
    }
    setSaving(true)
    setError(null)

    try {
      const noteFd = new FormData()
      noteFd.append('title', titleCaseWords(title))
      noteFd.append('content', '')
      if (categoryId) noteFd.append('categoryId', categoryId)
      if (subcategoryId) noteFd.append('subcategoryId', subcategoryId)
      if (isPrivate) noteFd.append('isPrivate', 'true')

      const noteResult = await createNote(noteFd)
      if (!noteResult || 'error' in noteResult) {
        setError(noteResult?.error ?? 'Could not create note.')
        setSaving(false)
        return
      }

      const fileFd = new FormData()
      fileFd.append('file', photo)
      fileFd.append('noteId', noteResult.id)
      if (categoryId) fileFd.append('categoryId', categoryId)
      if (isPrivate) fileFd.append('isPrivate', 'true')

      const fileResult = await uploadFile(fileFd)
      if (fileResult && 'error' in fileResult && fileResult.error) {
        // Note was created but the file upload failed — send the user to
        // the note so they can retry the upload manually rather than
        // losing the title they just typed.
        setError(`Note saved, but photo upload failed: ${fileResult.error}`)
        setTimeout(() => router.push(`/notes/${noteResult.id}`), 1500)
        setSaving(false)
        return
      }

      router.push(`/notes/${noteResult.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCapture}
          onClose={() => {
            // If they back out without capturing and there's no prior photo,
            // bounce back to the dashboard rather than leave them on an empty
            // page.
            setCameraOpen(false)
            if (!photo) router.back()
          }}
        />
      )}

      {scannerOpen && photo && (
        <DocScannerEditor
          file={photo}
          onAccept={(scanned) => {
            setScannerOpen(false)
            if (photoPreview) URL.revokeObjectURL(photoPreview)
            setPhoto(scanned)
            setPhotoPreview(URL.createObjectURL(scanned))
          }}
          onCancel={() => setScannerOpen(false)}
        />
      )}

      {photoPreview && (
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden border border-stone-700/60 bg-stone-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview} alt="" className="block w-full max-h-80 object-contain bg-black" />
            <div className="absolute top-2 right-2 flex gap-1.5">
              <button
                type="button"
                onClick={discardPhoto}
                title="Re-take"
                aria-label="Re-take photo"
                className="p-2 rounded-full bg-stone-900/80 hover:bg-stone-800 text-stone-200 transition"
              >
                <Camera size={15} />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-stone-900/40 hover:bg-stone-800/60 text-stone-200 border border-stone-700 hover:border-stone-600 rounded-lg transition"
            title="Drag corners over a document, straighten and clean up."
          >
            <ScanLine size={13} className="text-emerald-400" />
            Scan &amp; crop document
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => setTitle(titleCaseWords(e.currentTarget.value))}
            autoCapitalize="words"
            placeholder="Receipt, serial number, recipe card…"
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Category</label>
            <select
              value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId('') }}
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {filteredSubs.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Subcategory</label>
              <select
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
                className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              >
                <option value="">— None —</option>
                {filteredSubs.map((s) => (
                  <option key={s.id} value={s.id}>{getSubcategoryLabel(activeCategorySlug, s.name)}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {isSuperuser && (
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
            />
            Save to Admin Vault (superuser only)
          </label>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg transition"
          >
            <X size={14} />
            Cancel
          </Link>
          <button
            type="submit"
            disabled={!photo || !title.trim() || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:opacity-60 text-white rounded-lg transition"
          >
            {saving ? (
              <>
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save size={14} />
                Save
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
