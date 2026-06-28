// Short-display helpers for URLs.
//
// Lance flagged that long URLs make entry cards hard to read — full URLs
// like "https://accounts.google.com/signin/v2/identifier?service=mail&continue=…"
// dominate a phone-card and drown out the title + username. These helpers
// return a compact, hostname-only representation for list views; the full
// URL is still kept in the DB and shown on the detail page where it has
// room to breathe.

/**
 * Strip the protocol + leading "www." + trailing slashes from a URL string.
 * Returns the input unchanged when it doesn't parse cleanly so we never
 * accidentally hide content. Examples:
 *
 *   "https://www.amazon.com/dp/B08?ref=…"        →  "amazon.com"
 *   "http://accounts.google.com/signin?continue" →  "accounts.google.com"
 *   "netflix.com/help"                            →  "netflix.com"
 *   "not-a-url"                                   →  "not-a-url"
 *
 * Pass `withPath=true` to keep one path segment after the host — handy when
 * the host alone is too generic (e.g. "google.com/photos" reads better than
 * just "google.com").
 */
export function prettyHost(input: string | null | undefined, withPath = false): string {
  if (!input) return ''
  const trimmed = input.trim()
  if (!trimmed) return ''

  // URL() requires a scheme. Try a few fallbacks so "amazon.com" parses
  // even though the user didn't type a protocol.
  let parsed: URL | null = null
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      parsed = new URL(candidate)
      break
    } catch {
      // try the next candidate
    }
  }
  if (!parsed) return trimmed

  const host = parsed.hostname.replace(/^www\./i, '')
  if (!withPath) return host

  // First non-empty path segment: e.g. /signup/business → "signup"
  const seg = parsed.pathname.split('/').find(Boolean)
  return seg ? `${host}/${seg}` : host
}

/**
 * Truncate a long string for inline display with a single ellipsis.
 * Used as a fallback when prettyHost() can't pull a hostname out.
 */
export function truncate(input: string | null | undefined, max = 40): string {
  if (!input) return ''
  if (input.length <= max) return input
  return `${input.slice(0, max - 1)}…`
}
