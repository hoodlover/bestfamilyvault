// Small formatters reused across UI components. Keep dependency-free so this
// file can be imported from both server components and client components.

/**
 * Human-readable file size. Picks the largest unit at which the number is
 * still ≥ 1 (e.g. 1500 → "1.5 KB", 2_500_000 → "2.4 MB", 3_500_000_000 → "3.3 GB").
 *
 * Uses 1024 as the base (KiB-style binary prefixes) — that matches what most
 * file managers show. Fractional units use one decimal place; bytes are whole.
 */
/**
 * Title-case an entry type — "credit_card" → "Credit Card", "login" →
 * "Login". Used wherever entry.type surfaces in the UI.
 */
export function formatEntryType(type: string): string {
  return type
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Strip HTML tags + decode the most common entities for use in previews
 * (line-clamped lists, search snippets, etc.). Note content is now
 * authored as Tiptap-emitted HTML; the previews don't render that HTML,
 * they show plain text — so this turns "<p>Hello <strong>world</strong></p>"
 * into "Hello world".
 *
 * Not a full sanitizer — for actual rendering we use Tiptap's read-only
 * editor in RichTextDisplay, which handles structure + safety.
 */
/**
 * Reformat raw SSN input to "000-00-0000". Handles partial entries:
 * 4 digits → "000-0", 6 digits → "000-00-0", etc. Strips non-digits
 * up front so paste from "000.00.0000" or "000 00 0000" lands clean.
 */
export function fmtSsn(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 9)
  if (d.length <= 3) return d
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
}

/**
 * Reformat raw phone input to "000.000.0000". Handles partial entries
 * and strips non-digits so paste from "(555) 123-4567" lands clean.
 */
export function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
}

export function stripHtml(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/<\s*br\s*\/?\s*>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
