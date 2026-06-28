// Domain matching for the autofill feature. We compare entries' stored
// `url` against the page the user is on (or the package name on
// mobile). Both sides get canonicalized to a "registrable domain"
// (eTLD+1) via the Public Suffix List, so:
//
//   https://www.netflix.com/login   → netflix.com
//   login.netflix.com               → netflix.com
//   bbc.co.uk                       → bbc.co.uk    (handles 2-level TLDs)
//
// This means a vault entry stored as https://www.netflix.com/foo
// matches when the user is on www.netflix.com, login.netflix.com, or
// any other subdomain. Tight enough that random-site.com doesn't
// inherit Netflix's credentials.
//
// State-government .gov caveat: tldts's PSL treats `.gov` as the
// public suffix and collapses every US state government host to
// `<state>.gov` — so eresponse.gdol.ga.gov, portal.ers.ga.gov, and
// ecorp.sos.ga.gov all reduce to `ga.gov` and inherit each other's
// credentials in the autofill popup. Lance hit this with his Georgia
// state logins. To fix it without forking tldts, we detect the
// `<state>.gov` shape (two segments, second is `.gov`, first is a US
// state code) and bump one more subdomain segment off the hostname
// so each state-agency host gets its own eTLD+1.

import { getDomain, parse as parseTld } from 'tldts'

// US state + territory two-letter codes used as second-level domains
// under .gov. Sourced from CISA's published list of state government
// TLDs. DC/AS/GU/MP/PR/VI included for completeness.
const US_STATE_GOV_CODES: ReadonlySet<string> = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy',
  'dc','as','gu','mp','pr','vi',
])

/**
 * Returns the registrable (eTLD+1) domain for a URL or hostname, or null
 * if it can't be parsed. Empty / non-http strings return null.
 *
 * For US state government hosts (where tldts wrongly collapses every
 * agency to `<state>.gov`) we bump one more subdomain segment so
 * `eresponse.gdol.ga.gov` → `gdol.ga.gov`, `ecorp.sos.ga.gov` →
 * `sos.ga.gov`, and the autofill no longer cross-pollinates agencies.
 */
export function extractRegistrableDomain(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  // tldts.getDomain accepts both bare hostnames ("netflix.com") and full
  // URLs ("https://www.netflix.com/foo"). Returns null for things that
  // don't look like web hosts (chrome://, about:, IP addresses, etc.).
  const baseDomain = getDomain(trimmed)
  if (!baseDomain) return null

  // State-government .gov rescue: if the base domain is exactly
  // `<2-letter-state>.gov`, the hostname has at least one more
  // meaningful segment we should keep (the agency).
  const segments = baseDomain.split('.')
  if (segments.length === 2 && segments[1] === 'gov' && US_STATE_GOV_CODES.has(segments[0])) {
    const parsed = parseTld(trimmed)
    const hostname = parsed.hostname
    if (hostname) {
      const hostnameSegments = hostname.split('.')
      // Last 3 segments = <agency>.<state>.gov. If the hostname is
      // exactly `<state>.gov` (no agency subdomain), keep the original.
      if (hostnameSegments.length >= 3) {
        return hostnameSegments.slice(-3).join('.')
      }
    }
  }
  return baseDomain
}

/**
 * True when the entry's stored URL resolves to the same registrable
 * domain as the query domain. Both sides are normalised; either side
 * being un-parseable means no match.
 */
export function entryMatchesDomain(entryUrl: string | null | undefined, queryDomain: string): boolean {
  const entryDomain = extractRegistrableDomain(entryUrl)
  const target = extractRegistrableDomain(queryDomain) ?? (queryDomain.trim().toLowerCase() || null)
  if (!entryDomain || !target) return false
  return entryDomain === target
}
