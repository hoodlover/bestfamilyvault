import 'server-only'

// Single source of truth for "what IP made this request?" Used by the
// login rate limiter + alert system. Vercel always populates
// x-forwarded-for; we take the first hop (the actual client) and fall
// back to x-real-ip / "unknown" so we never throw.

export function getClientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    // x-forwarded-for is a comma-separated chain "client, proxy1, proxy2".
    // The leftmost entry is the real client; everything after is
    // intermediate. Trim and bail if empty (defensive — shouldn't happen
    // on Vercel but local dev / curl tests can omit the header).
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
