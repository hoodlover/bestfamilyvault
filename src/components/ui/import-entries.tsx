'use client'

import { useState, useRef } from 'react'
import { clsx } from 'clsx'
import { Download, Upload, Check, AlertCircle, ChevronRight } from 'lucide-react'
import { importEntriesCSV, type EntryImportRow } from '@/lib/actions/import'
import { OWNER } from '@/lib/family-config'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>

// ─── Template definition ──────────────────────────────────────────────────────

const TEMPLATE_HEADERS = ['title', 'username', 'password', 'url', 'category', 'subcategory', 'notes', 'favorite', 'private']

const TEMPLATE_ROWS = [
  ['Gmail', OWNER.emails[0] ?? 'you@example.com', 'MyPassword123', 'https://mail.google.com', 'Home', '', 'Personal email', 'no', 'no'],
  ['Bank of America', OWNER.aliases?.[0] ?? 'username', 'BankPass!', 'https://bankofamerica.com', 'Finance', '', '', 'yes', 'no'],
  ['Netflix', '', 'StreamPass1', 'https://netflix.com', 'Entertainment', '', 'Family account', 'no', 'no'],
]

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim())
  const rows = lines.slice(1).map((line) => {
    const vals = parseCSVLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
  return { headers, rows }
}

// ─── Column mapper target fields ──────────────────────────────────────────────

const TARGET_FIELDS: { key: keyof EntryImportRow; label: string; required: boolean }[] = [
  { key: 'title',       label: 'Title',       required: true },
  { key: 'username',    label: 'Username',     required: false },
  { key: 'password',    label: 'Password',     required: false },
  { key: 'url',         label: 'URL',          required: false },
  { key: 'category',    label: 'Category',     required: false },
  { key: 'subcategory', label: 'Subcategory',  required: false },
  { key: 'notes',       label: 'Notes',        required: false },
  { key: 'favorite',    label: 'Favorite (yes/no)', required: false },
  { key: 'private',     label: 'Private (yes/no)',  required: false },
]

// ─── Download template ────────────────────────────────────────────────────────

function downloadTemplate() {
  const escape = (v: string) => v.includes(',') ? `"${v}"` : v
  const lines = [
    TEMPLATE_HEADERS.join(','),
    ...TEMPLATE_ROWS.map((r) => r.map(escape).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'cobbvault-entries-template.csv'
  a.click()
}

// ─── Component ────────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'preview' | 'done'

interface Props {
  categories: Category[]
}

export function ImportEntries({ categories }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string>>({}) // targetField → csvHeader
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)

  function handleFileUpload(file: File) {
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers, rows } = parseCSV(text)

      if (headers.length === 0) { setError('Could not parse CSV — is it empty?'); return }
      if (rows.length === 0) { setError('CSV has headers but no data rows.'); return }

      setParsedHeaders(headers)
      setParsedRows(rows)

      // Auto-map if headers match template exactly
      const isTemplate = TEMPLATE_HEADERS.every((h) => headers.includes(h))
      if (isTemplate) {
        const autoMap = Object.fromEntries(TEMPLATE_HEADERS.map((h) => [h, h]))
        setColumnMap(autoMap)
        setStep('preview')
      } else {
        // Auto-map any exact matches, show mapper for the rest
        const autoMap: Record<string, string> = {}
        for (const field of TARGET_FIELDS) {
          const match = headers.find((h) => h === field.key || h === field.label.toLowerCase())
          if (match) autoMap[field.key] = match
        }
        setColumnMap(autoMap)
        setStep('map')
      }
    }
    reader.readAsText(file)
  }

  function getMappedRows(): EntryImportRow[] {
    return parsedRows.map((row) => {
      const mapped: Record<string, string> = {}
      for (const [field, csvCol] of Object.entries(columnMap)) {
        if (csvCol) mapped[field] = row[csvCol] ?? ''
      }
      return mapped as unknown as EntryImportRow
    })
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    try {
      const rows = getMappedRows()
      const res = await importEntriesCSV(rows)
      setResult(res)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep('upload')
    setParsedHeaders([])
    setParsedRows([])
    setColumnMap({})
    setError(null)
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const mappedRows = step === 'preview' || step === 'done' ? getMappedRows() : []
  const canImport = columnMap['title'] && parsedRows.length > 0

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-stone-500">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={12} />}
            <span className={clsx(step === s ? 'text-emerald-400 font-medium' : '')}>
              {s === 'upload' ? '1. Upload' : s === 'map' ? '2. Map columns' : s === 'preview' ? '3. Preview' : '4. Done'}
            </span>
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-5">
          {/* Template download */}
          <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-200 mb-1">Step 1 — Download the template</h3>
            <p className="text-xs text-stone-400 mb-4">
              Fill in the spreadsheet with your login data. Save as <strong className="text-stone-300">.csv</strong> when done
              (File → Save As → CSV in Excel or Google Sheets → Download as CSV).
            </p>
            <div className="bg-stone-900 rounded-lg p-3 mb-4 overflow-x-auto">
              <table className="text-xs text-stone-400 w-full">
                <thead>
                  <tr>
                    {TEMPLATE_HEADERS.map((h) => (
                      <th key={h} className="text-left pr-4 pb-1 text-stone-500 font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATE_ROWS.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="pr-4 py-0.5 text-stone-400">{cell || <span className="text-stone-700">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-stone-500 space-y-1 mb-4">
              <p><strong className="text-stone-400">category</strong> — match an existing vault category name exactly (e.g. Finance, Home, Entertainment). Leave blank to use default.</p>
              <p><strong className="text-stone-400">subcategory</strong> — optional, must belong to the category above.</p>
              <p><strong className="text-stone-400">favorite / private</strong> — write <code className="text-emerald-400">yes</code> or <code className="text-emerald-400">no</code>.</p>
            </div>
            <div className="text-xs text-stone-500 mb-4">
              <strong className="text-stone-400">Your categories:</strong>{' '}
              {categories.map((c) => c.name).join(', ')}
            </div>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-stone-700 hover:bg-stone-600 border border-stone-600 text-stone-200 text-sm font-medium rounded-lg transition"
            >
              <Download size={15} />
              Download Template (CSV)
            </button>
          </div>

          {/* File upload */}
          <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-200 mb-1">Step 2 — Upload your filled CSV</h3>
            <p className="text-xs text-stone-400 mb-4">
              You can use the template above or your own CSV — if your column names differ, you&apos;ll map them in the next step.
            </p>
            <div
              className="border-2 border-dashed border-stone-600 hover:border-emerald-600/50 rounded-xl p-8 text-center cursor-pointer transition"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f) }}
            >
              <Upload size={24} className="text-stone-500 mx-auto mb-2" />
              <p className="text-sm text-stone-400">Drop CSV here or <span className="text-emerald-400">click to browse</span></p>
              <p className="text-xs text-stone-600 mt-1">.csv files only</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
            />
          </div>

          {error && <ErrorBox message={error} />}
        </div>
      )}

      {/* ── Step: Map columns ── */}
      {step === 'map' && (
        <div className="space-y-5">
          <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-200 mb-1">Map your columns</h3>
            <p className="text-xs text-stone-400 mb-4">
              Your CSV has {parsedHeaders.length} columns and {parsedRows.length} rows. Match each vault field to the right column in your file.
              Fields marked <span className="text-red-400">*</span> are required.
            </p>

            {/* Sample data preview */}
            <div className="bg-stone-900 rounded-lg p-3 mb-5 overflow-x-auto">
              <p className="text-xs text-stone-500 mb-2 font-medium">Your CSV columns (first 2 rows):</p>
              <table className="text-xs">
                <thead>
                  <tr>
                    {parsedHeaders.map((h) => (
                      <th key={h} className="text-left pr-6 pb-1 text-stone-400 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 2).map((row, i) => (
                    <tr key={i}>
                      {parsedHeaders.map((h) => (
                        <td key={h} className="pr-6 py-0.5 text-stone-500 max-w-[120px] truncate">{row[h] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TARGET_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-stone-400 mb-1">
                    {field.label} {field.required && <span className="text-red-400">*</span>}
                  </label>
                  <select
                    value={columnMap[field.key] ?? ''}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-full px-2 py-1.5 bg-stone-900 border border-stone-700 rounded-lg text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
                  >
                    <option value="">— not mapped —</option>
                    {parsedHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200 transition">← Back</button>
            <button
              onClick={() => setStep('preview')}
              disabled={!canImport}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
            >
              Preview {parsedRows.length} rows →
            </button>
          </div>
          {error && <ErrorBox message={error} />}
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === 'preview' && (
        <div className="space-y-5">
          <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-200 mb-1">Preview — {mappedRows.length} entries</h3>
            <p className="text-xs text-stone-400 mb-4">Showing first 10 rows. All {mappedRows.length} will be imported.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-700">
                    <th className="text-left pb-2 pr-4 text-stone-500 font-medium">Title</th>
                    <th className="text-left pb-2 pr-4 text-stone-500 font-medium">Username</th>
                    <th className="text-left pb-2 pr-4 text-stone-500 font-medium">Password</th>
                    <th className="text-left pb-2 pr-4 text-stone-500 font-medium">Category</th>
                    <th className="text-left pb-2 text-stone-500 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b border-stone-800/50">
                      <td className="py-1.5 pr-4 text-stone-300 max-w-[160px] truncate">{row.title || <span className="text-red-400">missing!</span>}</td>
                      <td className="py-1.5 pr-4 text-stone-500 max-w-[120px] truncate">{row.username || '—'}</td>
                      <td className="py-1.5 pr-4 text-stone-500">{row.password ? '••••••' : '—'}</td>
                      <td className="py-1.5 pr-4 text-stone-500">{row.category || <span className="text-stone-600">default</span>}</td>
                      <td className="py-1.5 text-stone-500 max-w-[160px] truncate">{row.url || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {mappedRows.length > 10 && (
                <p className="text-xs text-stone-600 mt-2">+ {mappedRows.length - 10} more rows...</p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(parsedHeaders.some((h) => !TEMPLATE_HEADERS.includes(h)) ? 'map' : 'upload')} className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200 transition">← Back</button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
            >
              {importing ? 'Importing...' : `Import ${mappedRows.length} entries`}
            </button>
          </div>
          {error && <ErrorBox message={error} />}
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Check size={18} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-emerald-300">Import complete</h3>
            </div>
            <p className="text-sm text-stone-300">
              <strong className="text-emerald-400">{result.inserted}</strong> entries imported
              {result.skipped > 0 && <>, <strong className="text-yellow-400">{result.skipped}</strong> skipped</>}.
            </p>
          </div>
          {result.errors.length > 0 && (
            <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4">
              <p className="text-xs font-medium text-red-400 mb-2">Warnings:</p>
              <ul className="text-xs text-red-300 space-y-0.5">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <button onClick={reset} className="px-4 py-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 text-sm rounded-lg transition">
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2 text-sm text-red-300">
      <AlertCircle size={15} className="shrink-0 mt-0.5" />
      {message}
    </div>
  )
}
