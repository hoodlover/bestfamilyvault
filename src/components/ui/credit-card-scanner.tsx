'use client'

// Camera + Claude Vision field extraction for credit card data entry.

import { useRef, useState } from 'react'
import { Camera, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { ParsedCreditCardFields } from '@/lib/ocr-field-types'

export type ParsedCard = ParsedCreditCardFields

interface Props {
  /**
   * Fired with the OCR-extracted fields and the captured image file. The
   * file is handed back so the parent form can attach it to the entry.
   */
  onScan: (parsed: ParsedCard, file: File) => void
}

export function CreditCardScanner({ onScan }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [lastParsed, setLastParsed] = useState<ParsedCard | null>(null)
  const [lastFile, setLastFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0]
    if (!raw) return
    setError(null)
    setBusy(true)
    setLastParsed(null)
    try {
      const file = await rotateImageLeft(raw).catch(() => raw)
      setLastFile(file)
      setPreviewUrl(await readAsDataUrl(file))
      const parsed = await scanCard(file)
      setLastParsed(parsed)
      onScan(parsed, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the card.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runCloudScan() {
    if (!lastFile) return
    setBusy(true)
    setError(null)
    try {
      const parsed = await scanCard(lastFile, true)
      setLastParsed(parsed)
      onScan(parsed, lastFile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the card.')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setPreviewUrl(null)
    setLastParsed(null)
    setLastFile(null)
    setError(null)
  }

  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-800/40 p-3 space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />

      {!previewUrl && !busy && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition"
        >
          <Camera size={16} />
          Scan front or back of card
        </button>
      )}

      {busy && (
        <div className="flex flex-col items-center justify-center gap-2 py-4 text-stone-300">
          <Loader2 size={20} className="animate-spin text-emerald-400" />
          <p className="text-sm">Reading the card...</p>
          <p className="text-[11px] text-stone-500">Claude Vision will read this photo.</p>
        </div>
      )}

      {previewUrl && !busy && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Captured card" className="w-full rounded-lg border border-stone-700" />
          {lastParsed && hasAnyValue(lastParsed) && (
            <p className="text-[11px] text-emerald-300">
              Filled in what we could read. Double-check the fields below.
            </p>
          )}
          {lastParsed && !hasAnyValue(lastParsed) && (
            <p className="text-[11px] text-amber-300">
              Could not confidently read fields from this photo.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runCloudScan}
              disabled={!lastFile}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-amber-900/30 hover:bg-amber-900/50 text-amber-200 border border-amber-700/50 rounded-lg transition"
              title="Ask Claude Vision to read this same photo again."
            >
              <Sparkles size={13} />
              Try again
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg transition"
            >
              <RotateCcw size={13} />
              Re-scan
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-400 hover:text-stone-200 transition"
            >
              <X size={13} />
              Hide
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}

async function scanCard(file: File, useClaude = false): Promise<ParsedCard> {
  const fd = new FormData()
  fd.append('kind', 'credit_card')
  if (useClaude) fd.append('engine', 'claude')
  fd.append('file', file)
  const res = await fetch('/api/ocr-fields', { method: 'POST', body: fd })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Cloud scan failed (${res.status})`)
  }
  const data = (await res.json()) as { creditCard?: ParsedCard }
  return data.creditCard ?? {}
}

function hasAnyValue(p: ParsedCard): boolean {
  return !!(p.cardNumber || p.expiryDate || p.cardholderName || p.cardNetwork)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'))
    reader.readAsDataURL(file)
  })
}

async function rotateImageLeft(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalHeight
    canvas.height = img.naturalWidth
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.92))
    if (!blob) throw new Error('canvas.toBlob returned null')
    return new File([blob], file.name, { type: blob.type || outType })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
