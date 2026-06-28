// Computes a "duplicate site" fingerprint for an entry. Used by the merge
// candidates admin page to find groups of entries that probably represent
// the same login service across multiple family members.
//
// Strategy:
//   1. If the entry has a URL, extract the registrable domain (last 2 host
//      labels) so subdomains fold together — e.g. mycloud.com,
//      idp.mycloud.com, home.mycloud.com → "mycloud.com".
//   2. Otherwise normalize the title (lowercase, strip ®/™/©, drop trailing
//      "sign in" / "login" / year suffixes) and prefix it with "t:".
//   3. Return null if neither yields anything usable.

export function fingerprintEntry(e: { url: string | null; title: string }): string | null {
  if (e.url) {
    let u = e.url.trim().toLowerCase().replace(/^https?:\/\//, '')
    u = u.split('/')[0].split('?')[0]
    if (u.startsWith('www.')) u = u.slice(4)
    const parts = u.split('.').filter(Boolean)
    // For IPv4 (e.g. 192.168.0.1) keep all 4 octets so different routers stay separate
    const isIp = parts.length === 4 && parts.every((p) => /^\d+$/.test(p))
    const domain = isIp ? u : parts.length > 2 ? parts.slice(-2).join('.') : u
    if (domain && domain.length >= 4) return domain
  }

  const t = e.title
    .toLowerCase()
    .replace(/®|™|©/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(sign in|login|log in|signin|account|home)$/, '')
    .replace(/\s+(2023|2024|2025|2026)\s*$/, '')
    .trim()

  return t.length >= 3 ? `t:${t}` : null
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/®|™|©/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+\(\d+\)$/, '') // strip "Foo (3)" suffix from Sticky Password
    .replace(/\s+(sign in|login|log in|signin|account|home)$/, '')
    .replace(/\s+(2023|2024|2025|2026)\s*$/, '')
    .trim()
}
