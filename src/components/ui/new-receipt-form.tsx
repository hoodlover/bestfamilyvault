'use client'

// /receipts/new form. Handles single + batch in one component:
//   - 1 item   → looks like the original single-receipt flow
//   - 2+ items → each item gets its own row with merchant/amount/date,
//                title auto-suffixes "— N receipts — $X.XX" at save,
//                customFields.items holds the per-receipt detail
//
// All photos attach to the SAME entry. The title represents the batch
// intent ("Website stuff — Q2 2026"); per-receipt detail is on each
// attachment + serialized into customFields.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, FileText, Image as ImageIcon, Loader2, Plus, ScanLine, Sparkles, X } from 'lucide-react'
import { createReceiptEntry } from '@/lib/actions/receipts'
import { setStatementLineDecision } from '@/lib/actions/reconcile'
import { compressImage } from '@/lib/image-compress'
import { getSubcategoryLabel } from '@/lib/category-presentation'
import { CameraCapture } from './camera-capture'
import { DocScannerEditor } from './doc-scanner-editor'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories, subcategories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>
type Subcategory = InferSelectModel<typeof subcategories>

interface Props {
  categories: Category[]
  subcategories: Subcategory[]
  defaultCategoryId: string | null
  defaultSubcategoryId: string | null
  // Prefill from /reconcile's "Find / upload receipt" handoff. When
  // attachDecisionTo is set, a save will also flip that statement-line
  // decision to 'matched' and redirect back to /reconcile.
  prefillAmount?: string | null   // dollars string e.g. "54.59"
  prefillDate?: string | null     // YYYY-MM-DD
  prefillMerchant?: string | null
  attachDecisionTo?: string | null
}

interface ReceiptItem {
  id: string
  file: File
  previewUrl: string
  // false → render the file as a document card (icon + name), not <img>.
  // Skips OCR and image compression. Used for PDFs / docx / any
  // non-image receipt-as-document upload Lance has on disk.
  isImage: boolean
  merchant: string
  amountInput: string // dollars string, user-editable
  purchaseDate: string // YYYY-MM-DD or ''
  itemHint: string
  ocrBusy: boolean
  ocrTried: boolean
  ocrError: string | null
}

interface ParsedReceipt {
  merchant?: string
  totalCents?: number
  purchaseDate?: string
  itemHint?: string
}

let counter = 0
const nextId = () => `r${++counter}-${Date.now()}`

export function NewReceiptForm({
  categories,
  subcategories,
  defaultCategoryId,
  defaultSubcategoryId,
  prefillAmount,
  prefillDate,
  prefillMerchant,
  attachDecisionTo,
}: Props) {
  const router = useRouter()

  const [items, setItems] = useState<ReceiptItem[]>([])
  // Title seeds from the prefilled merchant + date so Lance doesn't have
  // to type a name when arriving from /reconcile.
  const seedTitle = (() => {
    if (!prefillMerchant && !prefillDate) return ''
    const stamp = prefillDate ? ` ${prefillDate}` : ''
    return `${prefillMerchant ?? 'Receipt'}${stamp}`.trim()
  })()
  const [title, setTitle] = useState(seedTitle)
  const [titleTouched, setTitleTouched] = useState(!!seedTitle)
  const [noteContent, setNoteContent] = useState('')
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? categories[0]?.id ?? '')
  const [subcategoryId, setSubcategoryId] = useState(defaultSubcategoryId ?? '')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [isPersonal, setIsPersonal] = useState(false)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cropTargetId, setCropTargetId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const galleryRef = useRef<HTMLInputElement>(null)
  const multiRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  // Revoke all object URLs on unmount so we don't leak blob: URIs.
  useEffect(() => {
    return () => {
      setItems((prev) => {
        for (const it of prev) URL.revokeObjectURL(it.previewUrl)
        return prev
      })
    }
  }, [])

  const filteredSubs = subcategories.filter((s) => s.categoryId === categoryId)
  const activeCategorySlug = categories.find((c) => c.id === categoryId)?.slug ?? ''
  const isBatch = items.length >= 2

  // Running total — sum of every item with a parseable amount.
  const totalCents = items.reduce((sum, it) => {
    const c = parseDollarsToCents(it.amountInput)
    return c == null ? sum : sum + c
  }, 0)

  async function addPhotos(rawFiles: File[]) {
    setError(null)
    const accepted: ReceiptItem[] = []
    // Seed the first new item with the /reconcile prefill if this is
    // the first add AND we have prefill values. After the first add the
    // user is in batch mode (their problem) so we don't keep prefilling.
    const noItemsYet = items.length === 0
    let prefillUsed = false
    for (const raw of rawFiles) {
      const isImg = raw.type.startsWith('image/')
      try {
        // Only compress images — running compressImage() against a PDF
        // throws (it tries to decode as a bitmap). Non-image files go
        // through verbatim.
        const file = isImg ? await compressImage(raw).catch(() => raw) : raw
        const id = nextId()
        const shouldPrefill = noItemsYet && !prefillUsed && (prefillAmount || prefillDate || prefillMerchant)
        if (shouldPrefill) prefillUsed = true
        accepted.push({
          id,
          file,
          previewUrl: URL.createObjectURL(file),
          isImage: isImg,
          merchant: shouldPrefill && prefillMerchant ? prefillMerchant : '',
          amountInput: shouldPrefill && prefillAmount ? prefillAmount : '',
          purchaseDate: shouldPrefill && prefillDate ? prefillDate : '',
          itemHint: '',
          // Only images get OCR'd — the /api/ocr-receipt endpoint
          // (Claude Vision) doesn't accept PDFs. Non-image uploads
          // start in a non-busy "ready for manual entry" state.
          ocrBusy: isImg,
          ocrTried: !isImg,
          ocrError: null,
        })
      } catch (err) {
        console.error('receipt intake', err)
      }
    }
    if (accepted.length === 0) return
    setItems((prev) => [...prev, ...accepted])
    // Kick off OCR for each new IMAGE item. PDFs/docx skip this step.
    // applyParsed() already preserves non-empty fields, so prefilled
    // merchant/amount/date survive an OCR pass.
    void ocrSequence(accepted.filter((it) => it.isImage))
  }

  async function ocrSequence(toScan: ReceiptItem[]) {
    for (const item of toScan) {
      await runOcr(item.id, item.file)
    }
  }

  async function runOcr(itemId: string, file: File) {
    updateItem(itemId, { ocrBusy: true, ocrError: null })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/ocr-receipt', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Receipt scan failed (${res.status})`)
      }
      const data = (await res.json()) as ParsedReceipt
      applyParsed(itemId, data)
    } catch (err) {
      updateItem(itemId, {
        ocrError: err instanceof Error ? err.message : 'Receipt scan failed.',
      })
    } finally {
      updateItem(itemId, { ocrBusy: false, ocrTried: true })
    }
  }

  function applyParsed(itemId: string, data: ParsedReceipt) {
    setItems((prev) => {
      const next = prev.map((it) => {
        if (it.id !== itemId) return it
        return {
          ...it,
          merchant: it.merchant || (data.merchant ?? ''),
          amountInput:
            it.amountInput ||
            (typeof data.totalCents === 'number' ? (data.totalCents / 100).toFixed(2) : ''),
          purchaseDate: it.purchaseDate || (data.purchaseDate ?? ''),
          itemHint: it.itemHint || (data.itemHint ?? ''),
        }
      })

      // Auto-fill title from the first item only — and only when the
      // user hasn't manually typed yet, and we're still in single mode.
      // Batch users always type their own intent-based title.
      if (!titleTouched && next.length === 1 && next[0].id === itemId) {
        const first = next[0]
        if (data.merchant) {
          const hint = data.itemHint ? ` — ${data.itemHint}` : ''
          const stamp = data.purchaseDate ? ` ${data.purchaseDate}` : ''
          setTitle(`${data.merchant}${hint}${stamp}`.trim())
        } else if (data.itemHint) {
          const stamp = data.purchaseDate ? ` ${data.purchaseDate}` : ''
          setTitle(`Receipt — ${data.itemHint}${stamp}`.trim())
        }
        // Best-fit category — only the first scanned item drives this,
        // and only if the user hasn't manually overridden.
        if (!categoryTouched) {
          void suggestCategory(first, data)
        }
      }
      return next
    })
  }

  async function suggestCategory(_first: ReceiptItem, data: ParsedReceipt) {
    const seed = data.merchant || data.itemHint
    if (!seed) return
    try {
      const res = await fetch('/api/suggest-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: seed, type: 'document' }),
      })
      if (!res.ok) return
      const json = (await res.json()) as { categorySlug?: string | null; subcategoryName?: string | null }
      if (!json.categorySlug || categoryTouched) return
      const cat = categories.find((c) => c.slug === json.categorySlug)
      if (!cat) return
      setCategoryId(cat.id)
      if (json.subcategoryName) {
        const sub = subcategories.find(
          (s) => s.categoryId === cat.id && s.name === json.subcategoryName,
        )
        setSubcategoryId(sub?.id ?? '')
      } else {
        setSubcategoryId('')
      }
    } catch {
      /* suggestion is opportunistic */
    }
  }

  function updateItem(itemId: string, patch: Partial<ReceiptItem>) {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)))
  }

  function removeItem(itemId: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === itemId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((it) => it.id !== itemId)
    })
  }

  function replaceItemFile(itemId: string, file: File) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it
        URL.revokeObjectURL(it.previewUrl)
        return {
          ...it,
          file,
          previewUrl: URL.createObjectURL(file),
          // Reset OCR fields — old values came from the pre-crop image.
          merchant: '',
          amountInput: '',
          purchaseDate: '',
          itemHint: '',
          ocrBusy: true,
          ocrTried: false,
          ocrError: null,
        }
      }),
    )
    void runOcr(itemId, file)
  }

  const cropTarget = cropTargetId ? items.find((it) => it.id === cropTargetId) : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (items.length === 0) {
      setError('Add at least one receipt photo.')
      return
    }
    if (!title.trim()) {
      setError('Give this a name.')
      return
    }
    // Per-item validation: each row needs an amount + merchant.
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.merchant.trim()) {
        setError(`Receipt #${i + 1}: add where it's from.`)
        return
      }
      if (parseDollarsToCents(it.amountInput) == null) {
        setError(`Receipt #${i + 1}: enter a valid amount.`)
        return
      }
    }

    setSaving(true)
    setError(null)

    const finalTitle = isBatch
      ? `${title.trim()} — ${items.length} receipts — ${formatDollars(totalCents)}`
      : title.trim()

    const fd = new FormData()
    fd.append('title', finalTitle)
    fd.append('categoryId', categoryId)
    if (subcategoryId) fd.append('subcategoryId', subcategoryId)
    if (noteContent.trim()) fd.append('noteContent', noteContent)
    if (isPersonal) fd.append('isPersonal', 'true')

    // Serialize items metadata so the server can validate + persist as
    // customFields.items. Files travel under repeated 'file' keys; the
    // server zips them with the metadata array by index.
    const itemsMeta = items.map((it) => ({
      merchant: it.merchant.trim(),
      totalCents: parseDollarsToCents(it.amountInput) ?? 0,
      purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(it.purchaseDate) ? it.purchaseDate : null,
    }))
    fd.append('items', JSON.stringify(itemsMeta))
    for (const it of items) {
      fd.append('file', it.file)
    }

    const result = await createReceiptEntry(fd)
    if (result?.error) {
      setError(result.error)
      setSaving(false)
      return
    }
    if (result?.success && result.id) {
      // /reconcile handoff: if this save was triggered from a "Find
      // receipt" link on a statement line, flip that line's decision
      // to 'matched' pointing at the new receipt, then bounce back to
      // /reconcile so Lance sees the matched state immediately. We do
      // NOT block the redirect on the decision call — if it fails for
      // any reason, the receipt still exists and he can manually link
      // it from /reconcile via "Link existing receipt".
      if (attachDecisionTo) {
        try {
          await setStatementLineDecision(attachDecisionTo, {
            decision: 'matched',
            receiptEntryId: result.id,
            note: null,
          })
        } catch (err) {
          console.warn('[new-receipt-form] decision flip failed:', err)
        }
        router.push('/reconcile')
        router.refresh()
        return
      }
      router.push(`/entries/${result.id}`)
      router.refresh()
      return
    }
    setSaving(false)
    setError('Unexpected error saving the receipt.')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {cameraOpen && (
        <CameraCapture
          fileName={`receipt-${Date.now()}.jpg`}
          onCapture={(file) => {
            setCameraOpen(false)
            void addPhotos([file])
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
      {cropTarget && (
        <DocScannerEditor
          file={cropTarget.file}
          // Receipts: histogram-stretch "Clean up" blows out paper-white
          // into glare and shifts color. Default off; user can toggle on.
          defaultEnhance={false}
          onAccept={(scanned) => {
            replaceItemFile(cropTarget.id, scanned)
            setCropTargetId(null)
          }}
          onCancel={() => setCropTargetId(null)}
        />
      )}

      {/* Intake buttons. Always visible, even with items already added,
          so users can build up a batch one shot at a time. 4-up grid on
          desktop, 2-up on mobile so the new "Upload doc" lands cleanly. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition"
        >
          <Camera size={15} />
          Take photo
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-900/40 text-sm font-medium text-stone-200 hover:border-stone-600 hover:bg-stone-800/60 transition"
        >
          <ImageIcon size={15} className="text-emerald-400" />
          Pick photo
        </button>
        <button
          type="button"
          onClick={() => multiRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-900/40 text-sm font-medium text-stone-200 hover:border-stone-600 hover:bg-stone-800/60 transition"
          title="Pick multiple receipts at once"
        >
          <Plus size={15} className="text-emerald-400" />
          Pick multiple
        </button>
        <button
          type="button"
          onClick={() => docRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-900/40 text-sm font-medium text-stone-200 hover:border-stone-600 hover:bg-stone-800/60 transition"
          title="Upload one or more receipt documents (PDFs, Word, etc.) from your computer or phone"
        >
          <FileText size={15} className="text-emerald-400" />
          Upload docs
        </button>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void addPhotos([file])
            e.target.value = ''
          }}
        />
        <input
          ref={multiRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void addPhotos(files)
            e.target.value = ''
          }}
        />
        {/* Doc upload — accepts PDFs, Word docs, and images, all
            multi-select. Lance asked for "multiple at a time" so the
            `multiple` attribute is present from the start. Image files
            are still routed through the same addPhotos path, which now
            branches on file.type for compression + OCR. */}
        <input
          ref={docRef}
          type="file"
          accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void addPhotos(files)
            e.target.value = ''
          }}
        />
      </div>

      {/* Running total / count banner — appears as soon as there are 2+
          receipts so the user knows the batch sum without scrolling. */}
      {isBatch && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-sm">
          <span className="text-emerald-200">
            <strong>{items.length}</strong> receipts staged
          </span>
          <span className="text-emerald-100 font-semibold">
            Total {formatDollars(totalCents)}
          </span>
        </div>
      )}

      {/* Receipt rows */}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((it, idx) => (
            <ReceiptRow
              key={it.id}
              item={it}
              index={idx}
              compact={isBatch}
              onChange={(patch) => updateItem(it.id, patch)}
              onCrop={() => setCropTargetId(it.id)}
              onRescan={() => runOcr(it.id, it.file)}
              onRemove={() => removeItem(it.id)}
            />
          ))}
        </div>
      )}

      {/* Entry-level fields */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Name *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setTitleTouched(true)
            }}
            placeholder={
              isBatch
                ? 'e.g. Website stuff — Q2 2026'
                : 'Receipt name (auto-fills from the photo)'
            }
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
          {isBatch && (
            <p className="mt-1 text-[11px] text-stone-500">
              We&rsquo;ll append <span className="text-stone-300">— {items.length} receipts — {formatDollars(totalCents)}</span> on save.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1.5">Category *</label>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value)
                setSubcategoryId('')
                setCategoryTouched(true)
              }}
              required
              className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {filteredSubs.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1.5">Subcategory</label>
              <select
                value={subcategoryId}
                onChange={(e) => {
                  setSubcategoryId(e.target.value)
                  setCategoryTouched(true)
                }}
                className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              >
                <option value="">None</option>
                {filteredSubs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {getSubcategoryLabel(activeCategorySlug, s.name)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Notes</label>
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={3}
            placeholder="Anything else (e.g. project, reimbursable, who paid)"
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-300">
          <input
            type="checkbox"
            checked={isPersonal}
            onChange={(e) => setIsPersonal(e.target.checked)}
            className="h-4 w-4 rounded border-stone-600 bg-stone-800 text-emerald-600 focus:ring-emerald-600"
          />
          Personal — only I can see this
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 px-4 py-2.5 bg-stone-800 border border-stone-700 rounded-lg text-stone-300 hover:bg-stone-700 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || items.length === 0}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-green-400 bg-green-500/25 hover:bg-green-500/40 disabled:bg-green-500/10 disabled:border-green-500/40 shadow-lg shadow-green-500/50 disabled:opacity-60 text-white font-medium rounded-lg transition"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Saving…
            </>
          ) : isBatch ? (
            `Save ${items.length} receipts`
          ) : (
            'Save receipt'
          )}
        </button>
      </div>
    </form>
  )
}

function ReceiptRow({
  item,
  index,
  compact,
  onChange,
  onCrop,
  onRescan,
  onRemove,
}: {
  item: ReceiptItem
  index: number
  compact: boolean
  onChange: (patch: Partial<ReceiptItem>) => void
  onCrop: () => void
  onRescan: () => void
  onRemove: () => void
}) {
  // Compact layout in batch mode: side-by-side thumb + fields. In single
  // mode, the thumb goes full-width like the original UI.
  if (!compact) {
    return (
      <div className="space-y-3">
        {item.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewUrl}
            alt={`Receipt ${index + 1}`}
            className="w-full max-h-[40vh] object-contain rounded-lg border border-stone-700 bg-stone-900"
          />
        ) : (
          <DocPreview file={item.file} />
        )}
        <RowActions
          ocrBusy={item.ocrBusy}
          ocrTried={item.ocrTried}
          isImage={item.isImage}
          onCrop={onCrop}
          onRescan={onRescan}
          onRemove={onRemove}
        />
        {item.ocrError && (
          <p className="text-[11px] text-amber-300">{item.ocrError}</p>
        )}
        <SingleFields item={item} onChange={onChange} />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-stone-700/60 bg-stone-900/40 p-3">
      <div className="flex items-start gap-3">
        {item.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewUrl}
            alt={`Receipt ${index + 1}`}
            className="w-24 h-24 object-cover rounded-md border border-stone-700 bg-stone-900 shrink-0"
          />
        ) : (
          <div className="w-24 h-24 flex flex-col items-center justify-center rounded-md border border-stone-700 bg-stone-900 shrink-0 px-1.5 py-2 text-center">
            <FileText size={28} className="text-emerald-400 shrink-0" />
            <span className="mt-1 text-[9px] text-stone-400 truncate max-w-full leading-tight">
              {item.file.name}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-stone-400">Receipt {index + 1}</span>
            {item.ocrBusy && (
              <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
                <Loader2 size={11} className="animate-spin text-emerald-400" />
                Reading…
              </span>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="p-1 text-stone-500 hover:text-stone-200 transition"
              aria-label="Remove this receipt"
            >
              <X size={14} />
            </button>
          </div>

          <input
            type="text"
            value={item.merchant}
            onChange={(e) => onChange({ merchant: e.target.value })}
            placeholder="From where"
            className="w-full px-2.5 py-1.5 bg-stone-800 border border-stone-600 rounded-md text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-500 text-sm">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={item.amountInput}
                onChange={(e) => onChange({ amountInput: e.target.value })}
                placeholder="0.00"
                className="w-full pl-6 pr-2 py-1.5 bg-stone-800 border border-stone-600 rounded-md text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
              />
            </div>
            <input
              type="date"
              value={item.purchaseDate}
              onChange={(e) => onChange({ purchaseDate: e.target.value })}
              className="w-full px-2 py-1.5 bg-stone-800 border border-stone-600 rounded-md text-sm text-stone-100 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onCrop}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-stone-300 hover:text-stone-100 bg-stone-800/60 border border-stone-700 hover:border-stone-600 rounded transition"
            >
              <ScanLine size={11} className="text-emerald-400" />
              Crop
            </button>
            <button
              type="button"
              onClick={onRescan}
              disabled={item.ocrBusy}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-amber-200 hover:text-amber-100 bg-amber-900/20 border border-amber-700/40 rounded transition disabled:opacity-50"
            >
              <Sparkles size={11} />
              Re-read
            </button>
          </div>
          {item.ocrError && (
            <p className="text-[11px] text-amber-300">{item.ocrError}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function SingleFields({
  item,
  onChange,
}: {
  item: ReceiptItem
  onChange: (patch: Partial<ReceiptItem>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">From where *</label>
          <input
            type="text"
            value={item.merchant}
            onChange={(e) => onChange({ merchant: e.target.value })}
            placeholder="Merchant or store"
            required
            className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-300 mb-1.5">Amount *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 text-sm">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={item.amountInput}
              onChange={(e) => onChange({ amountInput: e.target.value })}
              placeholder="0.00"
              required
              className="w-full pl-7 pr-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
            />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-300 mb-1.5">Date</label>
        <input
          type="date"
          value={item.purchaseDate}
          onChange={(e) => onChange({ purchaseDate: e.target.value })}
          className="w-full px-3 py-2.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:border-emerald-600 transition"
        />
      </div>
    </div>
  )
}

function RowActions({
  ocrBusy,
  ocrTried,
  isImage,
  onCrop,
  onRescan,
  onRemove,
}: {
  ocrBusy: boolean
  ocrTried: boolean
  isImage: boolean
  onCrop: () => void
  onRescan: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {/* Crop + OCR only apply to images. For PDFs / doc uploads we
          hide them — Lance just fills in merchant/amount/date by hand
          and saves; no document-cropper exists for non-image files. */}
      {isImage && (
        <button
          type="button"
          onClick={onCrop}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-stone-900/40 hover:bg-stone-800/60 text-stone-200 border border-stone-700 hover:border-stone-600 rounded-lg transition"
        >
          <ScanLine size={13} className="text-emerald-400" />
          Crop &amp; straighten
        </button>
      )}
      {isImage && (
        <button
          type="button"
          onClick={onRescan}
          disabled={ocrBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-900/30 hover:bg-amber-900/50 text-amber-200 border border-amber-700/50 rounded-lg transition disabled:opacity-60"
        >
          {ocrBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {ocrBusy ? 'Reading…' : ocrTried ? 'Re-read' : 'Read receipt'}
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-400 hover:text-stone-200 transition"
      >
        <X size={13} />
        Remove
      </button>
    </div>
  )
}

function DocPreview({ file }: { file: File }) {
  // Static card stand-in for the image preview when the user uploaded a
  // PDF / Word doc as the receipt. The actual file gets attached to the
  // entry on save — Lance can open/preview it from the entry page.
  return (
    <div className="flex items-center gap-3 px-4 py-6 rounded-lg border border-stone-700 bg-stone-900">
      <FileText size={32} className="text-emerald-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-100 truncate">{file.name}</p>
        <p className="text-[11px] text-stone-500 mt-0.5">
          {file.type || 'unknown'} · {Math.max(1, Math.round(file.size / 1024))} KB · fill in details below and save
        </p>
      </div>
    </div>
  )
}

function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
