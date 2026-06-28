// Renders user-supplied text with embedded URLs auto-converted to clickable
// links. Long URLs are visually shortened (host + first chars of path,
// ellipsised) while the full URL stays in href.
//
// Notes:
//   - This is a plain component (no 'use client', no server-only APIs) so it
//     works in both server and client trees.
//   - Do NOT use this inside an anchor / <Link> wrapper — nested anchors are
//     invalid HTML. (The note card preview avoids it for that reason.)

import React from 'react'

// Match http(s) URLs and bare www.domain.tld URLs, stopping at whitespace
// or quote/bracket/angle characters. Trailing punctuation handled below.
//
// Also matches internal app paths starting with /<known-route> so notes
// can reference vault destinations directly without the user having to
// remember the full domain. Restricted to a known route allowlist so
// random "1/2" or "and/or" text doesn't accidentally linkify.
const APP_ROUTES = [
  'admin',
  'capsules',
  'categories',
  'dashboard',
  'eggs',
  'entries',
  'files',
  'forgot-password',
  'guide',
  'import',
  'letters',
  'login',
  'messages',
  'my-vault',
  'notes',
  'now-what',
  'recipes',
  'register',
  'reset-password',
  'search',
  'settings',
  'subscriptions',
  'vault',
].join('|')
// Combined regex: matches a markdown-style `[label](href)` link FIRST,
// then falls through to bare URLs and internal app paths. Markdown links
// take precedence so the inner href (e.g. /entries/abc-123) doesn't get
// independently autolinked and double-render. Used by the IDNW fill
// wizard to insert a chosen vault card as `[Title](/entries/<id>)` so
// answers display the human title instead of the raw URL path.
const URL_RE = new RegExp(
  `(\\[[^\\]\\n]{1,200}\\]\\([^)\\n\\s]{1,400}\\))` +
    '|' +
    `(https?:\\/\\/[^\\s<>"'\\]\\)]+|www\\.[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:\\/[^\\s<>"'\\]\\)]*)?|\\/(?:${APP_ROUTES})(?:\\/[A-Za-z0-9_~-]+)*\\/?)`,
  'gi',
)

// Trim punctuation that is unlikely to be part of the URL itself
function trimTrailingPunctuation(url: string): { url: string; trail: string } {
  const m = url.match(/[).,;:!?'"]+$/)
  if (!m) return { url, trail: '' }
  return { url: url.slice(0, -m[0].length), trail: m[0] }
}

function shortenForDisplay(url: string, maxLen = 36): string {
  const display = url.replace(/^https?:\/\//, '').replace(/^www\./, '')
  if (display.length <= maxLen) return display
  return display.slice(0, maxLen - 1) + '…'
}

interface Props {
  text: string | null | undefined
  className?: string
  /** Style applied to anchor tags. Default: emerald, underlined. */
  linkClassName?: string
  /** Maximum displayed URL length. Default 36. */
  maxLinkLen?: number
}

export function LinkifiedText({ text, className, linkClassName, maxLinkLen = 36 }: Props) {
  if (!text) return null

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0
  const matches = text.matchAll(URL_RE)

  for (const m of matches) {
    const start = m.index ?? 0
    if (start > lastIndex) {
      parts.push(<React.Fragment key={key++}>{text.slice(lastIndex, start)}</React.Fragment>)
    }

    // First capture group is the markdown-link form `[label](href)`. When
    // present, render the label as the visible text with the href on the
    // anchor — that's how IDNW answers hide the raw URL behind the card
    // title Lance picked.
    const mdMatch = m[1] ? m[1].match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) : null
    if (mdMatch) {
      const label = mdMatch[1].trim()
      const rawHref = mdMatch[2].trim()
      const isInternal = rawHref.startsWith('/')
      const href = isInternal
        ? rawHref
        : rawHref.startsWith('http')
          ? rawHref
          : `https://${rawHref}`
      parts.push(
        <a
          key={key++}
          href={href}
          target={isInternal ? undefined : '_blank'}
          rel={isInternal ? undefined : 'noopener noreferrer'}
          title={rawHref}
          className={
            linkClassName ??
            'text-emerald-400 hover:text-emerald-300 underline decoration-emerald-700 hover:decoration-emerald-500 underline-offset-2'
          }
        >
          {label}
        </a>
      )
      lastIndex = start + m[0].length
      continue
    }

    const { url: cleanUrl, trail } = trimTrailingPunctuation(m[0])
    const isInternal = cleanUrl.startsWith('/')
    const href = isInternal
      ? cleanUrl
      : cleanUrl.startsWith('http')
        ? cleanUrl
        : `https://${cleanUrl}`
    parts.push(
      <a
        key={key++}
        href={href}
        // Internal paths stay in-app; external still opens a new tab.
        target={isInternal ? undefined : '_blank'}
        rel={isInternal ? undefined : 'noopener noreferrer'}
        title={cleanUrl}
        className={
          linkClassName ??
          'text-emerald-400 hover:text-emerald-300 underline decoration-emerald-700 hover:decoration-emerald-500 underline-offset-2 break-all'
        }
      >
        {isInternal ? cleanUrl : shortenForDisplay(cleanUrl, maxLinkLen)}
      </a>
    )
    if (trail) parts.push(<React.Fragment key={key++}>{trail}</React.Fragment>)
    lastIndex = start + m[0].length
  }

  if (lastIndex < text.length) {
    parts.push(<React.Fragment key={key++}>{text.slice(lastIndex)}</React.Fragment>)
  }

  return <span className={className}>{parts}</span>
}
