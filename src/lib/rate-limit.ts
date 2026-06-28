import 'server-only'

import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from './db'
import { loginAttempts } from './db/schema'
import { sendEmail } from './email'
import { APP_NAME } from './branding'

// ─── Thresholds ─────────────────────────────────────────────────────────────
//
// Tuned for a 6-person family vault. With ~6 daily real logins from a
// handful of devices, 8 failures in 15 minutes from one IP is already
// far above any honest mistake. The (email, ip) bucket protects against
// a slower drip targeting one account from one source.
//
// We never surface a "blocked" message to the client — the response is
// always the same generic "Invalid email or password". Throttling is
// invisible to the attacker, so they can't time around it.

const WINDOW_MS = 15 * 60 * 1000

const MAX_FAILED_PER_IP = 8
const MAX_FAILED_PER_EMAIL_IP = 5

/**
 * Should this login attempt be tarpitted+rejected before bcrypt runs?
 * Returns true once an IP or (email, ip) pair has crossed its failure
 * threshold inside the rolling window. Counts only `succeeded = false`
 * rows — a successful login resets the bucket for the matching keys
 * because new rows pushed in after a success no longer count as
 * consecutive failures (the threshold is purely about volume in the
 * window, not contiguity).
 */
export async function shouldThrottleLogin(params: {
  ip: string
  email: string
}): Promise<boolean> {
  const { ip, email } = params
  const cutoff = new Date(Date.now() - WINDOW_MS)

  // Single round-trip — count BOTH buckets in one query so we don't
  // pay for two network hops every login attempt.
  const [row] = await db
    .select({
      ipFails: sql<number>`count(*) filter (where ${loginAttempts.ip} = ${ip} and ${loginAttempts.succeeded} = false)::int`,
      pairFails: sql<number>`count(*) filter (where ${loginAttempts.ip} = ${ip} and ${loginAttempts.email} = ${email.toLowerCase()} and ${loginAttempts.succeeded} = false)::int`,
    })
    .from(loginAttempts)
    .where(gte(loginAttempts.attemptedAt, cutoff))

  if (!row) return false
  if (row.ipFails >= MAX_FAILED_PER_IP) return true
  if (row.pairFails >= MAX_FAILED_PER_EMAIL_IP) return true
  return false
}

/**
 * Persist one login attempt. Never throws — DB failure shouldn't break
 * the login itself, just the rate-limit signal. Best-effort.
 */
export async function recordLoginAttempt(params: {
  ip: string
  email: string
  succeeded: boolean
  userAgent: string | null
}): Promise<void> {
  try {
    await db.insert(loginAttempts).values({
      ip: params.ip,
      email: params.email.toLowerCase(),
      succeeded: params.succeeded,
      userAgent: params.userAgent,
    })
  } catch (err) {
    console.warn('[rate-limit] recordLoginAttempt failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * After a successful login, fire an email to the user if this IP has
 * never been seen for their email before. Suppressed for the user's
 * VERY first successful login ever — no point alerting on first sign-in.
 *
 * Best-effort: never throws, never blocks the login.
 */
export async function maybeNotifyNewDevice(params: {
  email: string
  ip: string
  userAgent: string | null
}): Promise<void> {
  const { email, ip, userAgent } = params
  try {
    const lower = email.toLowerCase()

    // Get the total successful-login count for this email AND whether
    // this IP has ever produced a successful login for it.
    const [counts] = await db
      .select({
        successesTotal: sql<number>`count(*) filter (where ${loginAttempts.succeeded} = true)::int`,
        successesThisIp: sql<number>`count(*) filter (where ${loginAttempts.succeeded} = true and ${loginAttempts.ip} = ${ip})::int`,
      })
      .from(loginAttempts)
      .where(eq(loginAttempts.email, lower))

    if (!counts) return

    // First-ever successful login → user is registering / first sign-in.
    // Don't alarm them. Subsequent new-IP successes always alert.
    // Note: we already wrote the current attempt before calling this,
    // so the just-completed login is counted in successesTotal (== 1
    // when it's the first ever). successesThisIp == 1 too in that case.
    if (counts.successesTotal <= 1) return

    // Has this IP been seen succeeding before? successesThisIp counts
    // the row we just inserted, so 1 means "only this brand-new attempt".
    if (counts.successesThisIp > 1) return

    await sendNewDeviceEmail({ email: lower, ip, userAgent })
  } catch (err) {
    console.warn('[rate-limit] maybeNotifyNewDevice failed:', err instanceof Error ? err.message : err)
  }
}

async function sendNewDeviceEmail(params: {
  email: string
  ip: string
  userAgent: string | null
}) {
  const { email, ip, userAgent } = params
  const when = new Date().toUTCString()
  const ua = userAgent ?? '(unknown browser)'
  const subject = `New sign-in to ${APP_NAME} from a new device`
  const text = [
    `Someone just signed in to your ${APP_NAME} account from a device or location we haven't seen before.`,
    '',
    `When:        ${when}`,
    `IP address:  ${ip}`,
    `Device:      ${ua}`,
    '',
    `If this was you, no action needed.`,
    `If it wasn't, sign in and change your password immediately at https://bestfamilyvault.com/settings.`,
  ].join('\n')
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px;">
      <h2>New sign-in to ${APP_NAME}</h2>
      <p>Someone just signed in to your account from a device or location we haven't seen before.</p>
      <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">When</td><td>${when}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">IP address</td><td><code>${ip}</code></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">Device</td><td><code>${ua}</code></td></tr>
      </table>
      <p>If this was you, no action needed.</p>
      <p>If it wasn't, sign in and <a href="https://bestfamilyvault.com/settings">change your password immediately</a>.</p>
    </div>
  `
  await sendEmail({ to: email, subject, text, html })
}

/**
 * Always-on tarpit — sleep ~800ms on every failed login so timing
 * attacks can't distinguish "wrong password" from "user doesn't exist"
 * from "rate-limited". Cheap; the legitimate user barely notices.
 */
export function tarpit(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 800))
}
