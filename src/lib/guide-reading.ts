export function hideUnansweredGuideLines(content: string): string {
  if (!content) return ''

  return content
    .split('\n')
    .filter((line) => !/_{3,}/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Detect Tiptap-authored HTML so we can convert it back to plain text
// with paragraph breaks preserved before running the rest of the
// reading-mode pipeline.
const HTML_TAG_RE = /<\/(p|div|ul|ol|li|h[1-6]|blockquote|pre|code|br|strong|em|u|mark|span|a|table|tr|td|th)\b[^>]*>/i
function looksLikeHtml(s: string): boolean {
  return HTML_TAG_RE.test(s) || /<br\s*\/?\s*>/i.test(s)
}

/** Turn Tiptap HTML into plain text WITH paragraph breaks. Differs
 *  from the generic lib/format.ts stripHtml (which collapses every
 *  whitespace run including \n into a single space) — for the reading
 *  mode we need <p> / <br> to materialize as real newlines so the
 *  whitespace-pre-wrap display + the CopyButton both round-trip the
 *  user's visual structure. */
function htmlToPlainTextWithBreaks(html: string): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(ul|ol|h[1-6]|blockquote|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanGuideContentForReading(content: string): string {
  // If the note was authored / edited through the Tiptap editor, its
  // content is HTML. Convert to plain text with paragraph breaks first,
  // then run the same reading-mode transforms the original plain-text
  // notes have always used. Without this, IDNW notes saved through
  // the rich editor render their raw <p> markup as visible text on the
  // detail page and the Copy button hands out HTML soup.
  const textContent = looksLikeHtml(content) ? htmlToPlainTextWithBreaks(content) : content
  return normalizeGuideLineBreaks(hideUnansweredGuideLines(textContent))
}

/** Splits already-normalized prose into discrete paragraphs. Use this when
 *  rendering with explicit <p> tags so paragraph spacing comes from CSS
 *  margins instead of preserved newlines — mobile word-wrap behaves much
 *  better that way than whitespace-pre-wrap on narrow screens. */
export function paragraphsOf(content: string): string[] {
  if (!content) return []
  return content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

export function normalizeGuideLineBreaks(content: string): string {
  if (!content) return ''

  const output: string[] = []
  let prose: string[] = []

  const flushProse = () => {
    if (prose.length === 0) return
    output.push(prose.join(' ').replace(/\s+/g, ' ').trim())
    prose = []
  }

  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushProse()
      if (output[output.length - 1] !== '') output.push('')
      continue
    }

    if (isGuideBlockLine(line)) {
      flushProse()
      output.push(line)
      continue
    }

    prose.push(trimmed)
  }

  flushProse()

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isGuideBlockLine(line: string): boolean {
  const trimmed = line.trim()

  return (
    /^[-*]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^[A-Z0-9][A-Z0-9 /&+'().-]{2,}:$/.test(trimmed) ||
    /^[A-Z0-9][A-Z0-9 /&+'().-]{2,}$/.test(trimmed) ||
    /^\s{2,}(?:[-*]|[—-])\s+/.test(line) ||
    /^[^:]{1,52}:\s*(?:$|_{3,}|\/|see\b)/i.test(trimmed)
  )
}
