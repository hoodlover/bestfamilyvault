'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { ParsedIdentityFields } from '@/lib/ocr-field-types'

interface Props {
  onScan: (parsed: ParsedIdentityFields, file: File) => void
}

export function IdentityDocumentScanner({ onScan }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [lastParsed, setLastParsed] = useState<ParsedIdentityFields | null>(null)
  const [lastFile, setLastFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setLastParsed(null)
    try {
      setLastFile(file)
      setPreviewUrl(await readAsDataUrl(file))
      const parsed = await scanIdentity(file)
      setLastParsed(parsed)
      onScan(parsed, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the document.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runClaudeScan() {
    if (!lastFile) return
    setBusy(true)
    setError(null)
    try {
      const parsed = await scanIdentity(lastFile, true)
      setLastParsed(parsed)
      onScan(parsed, lastFile)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the document.')
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
          Scan ID or certificate
        </button>
      )}

      {busy && (
        <div className="flex flex-col items-center justify-center gap-2 py-4 text-stone-300">
          <Loader2 size={20} className="animate-spin text-emerald-400" />
          <p className="text-sm">Reading fields...</p>
          <p className="text-[11px] text-stone-500">Claude Vision will read this photo.</p>
        </div>
      )}

      {previewUrl && !busy && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Captured document" className="w-full rounded-lg border border-stone-700" />
          {lastParsed && hasAnyValue(lastParsed) && (
            <p className="text-[11px] text-emerald-300">
              Filled in what we could read. Double-check before saving.
            </p>
          )}
          {lastParsed && !hasAnyValue(lastParsed) && (
            <p className="text-[11px] text-amber-300">Could not confidently read fields from this photo.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runClaudeScan}
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

async function scanIdentity(file: File, useClaude = false): Promise<ParsedIdentityFields> {
  const fd = new FormData()
  fd.append('kind', 'identity')
  if (useClaude) fd.append('engine', 'claude')
  fd.append('file', file)
  const res = await fetch('/api/ocr-fields', { method: 'POST', body: fd })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Field scan failed (${res.status})`)
  }
  const data = (await res.json()) as { identity?: ParsedIdentityFields }
  return data.identity ?? {}
}

function hasAnyValue(p: ParsedIdentityFields): boolean {
  return !!(p.firstName || p.lastName || p.dateOfBirth || p.ssn || p.passport || p.driversLicense)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'))
    reader.readAsDataURL(file)
  })
}
