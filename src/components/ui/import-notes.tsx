'use client'

import { useState, useRef } from 'react'
import { clsx } from 'clsx'
import { Check, AlertCircle, FileText } from 'lucide-react'
import { importNotesCSV, type NoteImportRow } from '@/lib/actions/import'
import type { InferSelectModel } from 'drizzle-orm'
import type { categories } from '@/lib/db/schema'

type Category = InferSelectModel<typeof categories>

// ─── CSV parsing (reused) ─────────────────────────────────────────────────────

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

// ─── Parse plain text notes (=== separator format) ────────────────────────────

function parseTextNotes(text: string, defaultCategory: string): NoteImportRow[] {
  // Split on lines that are === or --- (with optional surrounding spaces)
  const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/^={3,}|^-{3,}/m)
  const notes: NoteImportRow[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim()) // keep content
    if (lines.length === 0) continue

    // First non-empty line is the title
    const titleIdx = lines.findIndex((l) => l.trim())
    if (titleIdx === -1) continue

    const title = lines[titleIdx].trim()
    const content = lines.slice(titleIdx + 1).join('\n').trim()

    if (!title) continue

    notes.push({
      title,
      content: content || '',
      category: defaultCategory,
    })
  }

  return notes
}

// ─── Component ────────────────────────────────────────────────────────────────

type Mode = 'text' | 'csv'
type Step = 'upload' | 'preview' | 'done'

interface Props {
  categories: Category[]
}

export function ImportNotes({ categories }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('text')
  const [step, setStep] = useState<Step>('upload')
  const [notes, setNotes] = useState<NoteImportRow[]>([])
  const [defaultCategory, setDefaultCategory] = useState(categories[0]?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)

  function handleFile(file: File) {
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string

      if (mode === 'text') {
        const parsed = parseTextNotes(text, defaultCategory)
        if (parsed.length === 0) { setError('No notes found. Make sure notes are separated by === or --- on their own line.'); return }
        // Override category with defaultCategory since text format doesn't have per-note category
        setNotes(parsed.map((n) => ({ ...n, category: defaultCategory })))
        setStep('preview')
      } else {
        // CSV mode
        const { headers, rows } = parseCSV(text)
        if (!headers.includes('title')) { setError('CSV must have a "title" column.'); return }
        const parsed: NoteImportRow[] = rows.map((row) => ({
          title: row['title'] ?? '',
          content: row['content'] ?? row['body'] ?? row['text'] ?? '',
          category: row['category'] || defaultCategory,
          subcategory: row['subcategory'] ?? '',
          private: row['private'] ?? 'no',
        }))
        setNotes(parsed)
        setStep('preview')
      }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    try {
      const res = await importNotesCSV(notes)
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
    setNotes([])
    setError(null)
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-6">
      {step === 'upload' && (
        <>
          {/* Mode tabs */}
          <div className="flex gap-2">
            {(['text', 'csv'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  'px-4 py-1.5 rounded-lg text-sm font-medium transition',
                  mode === m ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
                )}
              >
                {m === 'text' ? 'Plain text (.txt)' : 'Spreadsheet (.csv)'}
              </button>
            ))}
          </div>

          {/* Instructions */}
          {mode === 'text' ? (
            <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-stone-200 mb-1">Plain text format</h3>
                <p className="text-xs text-stone-400">
                  Open Notepad or any text editor. Write your notes separated by <code className="text-emerald-400">===</code> or <code className="text-emerald-400">---</code> on its own line.
                  The first line after the separator becomes the note title.
                </p>
              </div>

              <div className="bg-stone-900 rounded-lg p-4">
                <p className="text-xs text-stone-500 mb-2 font-medium uppercase tracking-wider">Example .txt file:</p>
                <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">{`=== Doctor Contact Info ===
Dr. Smith: (555) 123-4567
Patient portal: myhealth.com
Insurance: BlueCross #12345

=== WiFi Passwords ===
Home WiFi: CobbFamily5642
Guest WiFi: Guests2024

---
Garage Door Code
Code: 1972*
Gate remote: spare in junk drawer`}</pre>
              </div>

              <div className="text-xs text-stone-500 space-y-1">
                <p>• Each note starts after a <code className="text-emerald-400">===</code> or <code className="text-emerald-400">---</code> separator line</p>
                <p>• The first line after the separator is the note title</p>
                <p>• Everything after that is the note content</p>
                <p>• Save as <strong className="text-stone-300">.txt</strong> — plain text, not Word document format</p>
                <p className="text-yellow-500">• Word docs (.docx) must be saved as Plain Text first: File → Save As → Plain Text (.txt)</p>
              </div>
            </div>
          ) : (
            <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-stone-200 mb-1">CSV format for notes</h3>
                <p className="text-xs text-stone-400">
                  Create a spreadsheet with these columns. Save as <strong className="text-stone-300">.csv</strong>.
                </p>
              </div>

              <div className="bg-stone-900 rounded-lg p-3 overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr>
                      {['title', 'content', 'category', 'subcategory', 'private'].map((h) => (
                        <th key={h} className="text-left pr-6 pb-1.5 text-stone-500 font-medium uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="pr-6 py-0.5 text-stone-400">Doctor Info</td>
                      <td className="pr-6 py-0.5 text-stone-400">Dr. Smith: (555) 123-4567</td>
                      <td className="pr-6 py-0.5 text-stone-400">Health</td>
                      <td className="pr-6 py-0.5 text-stone-600">—</td>
                      <td className="pr-6 py-0.5 text-stone-400">no</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5 text-stone-400">WiFi Passwords</td>
                      <td className="pr-6 py-0.5 text-stone-400">Home: CobbFamily5642</td>
                      <td className="pr-6 py-0.5 text-stone-400">Home</td>
                      <td className="pr-6 py-0.5 text-stone-600">—</td>
                      <td className="pr-6 py-0.5 text-stone-400">no</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="text-xs text-stone-500 space-y-1">
                <p>• <strong className="text-stone-400">title</strong> — required</p>
                <p>• <strong className="text-stone-400">content</strong> — the note body (also accepts &quot;body&quot; or &quot;text&quot; as column name)</p>
                <p>• <strong className="text-stone-400">category</strong> — must match an existing category name: {categories.map((c) => c.name).join(', ')}</p>
                <p>• <strong className="text-stone-400">private</strong> — yes or no</p>
              </div>
            </div>
          )}

          {/* Default category picker */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-stone-400 shrink-0">
              {mode === 'text' ? 'Assign all notes to:' : 'Default category (if column is blank):'}
            </label>
            <select
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value)}
              className="px-3 py-1.5 bg-stone-800 border border-stone-600 rounded-lg text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* File upload */}
          <div
            className="border-2 border-dashed border-stone-600 hover:border-emerald-600/50 rounded-xl p-8 text-center cursor-pointer transition"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          >
            <FileText size={24} className="text-stone-500 mx-auto mb-2" />
            <p className="text-sm text-stone-400">
              Drop {mode === 'text' ? '.txt' : '.csv'} here or{' '}
              <span className="text-emerald-400">click to browse</span>
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={mode === 'text' ? '.txt,text/plain' : '.csv,text/csv'}
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {error && (
            <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2 text-sm text-red-300">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </>
      )}

      {/* ── Preview ── */}
      {step === 'preview' && (
        <div className="space-y-5">
          <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-200 mb-1">Preview — {notes.length} notes</h3>
            <div className="space-y-2 mt-3">
              {notes.slice(0, 8).map((note, i) => (
                <div key={i} className="bg-stone-900 rounded-lg px-3 py-2">
                  <p className="text-sm text-stone-200 font-medium">{note.title}</p>
                  {note.content && (
                    <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{note.content}</p>
                  )}
                  <p className="text-xs text-stone-600 mt-1">{note.category}</p>
                </div>
              ))}
              {notes.length > 8 && (
                <p className="text-xs text-stone-600">+ {notes.length - 8} more notes...</p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200 transition">← Back</button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition"
            >
              {importing ? 'Importing...' : `Import ${notes.length} notes`}
            </button>
          </div>
          {error && (
            <div className="flex items-start gap-2 bg-red-950/20 border border-red-800/40 rounded-lg px-3 py-2 text-sm text-red-300">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Check size={18} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-emerald-300">Import complete</h3>
            </div>
            <p className="text-sm text-stone-300">
              <strong className="text-emerald-400">{result.inserted}</strong> notes imported
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
