import 'server-only'

import { and, desc, eq, isNotNull, isNull, or, gte, lte } from 'drizzle-orm'
import { db } from './db'
import { entries, users, balanceHistory } from './db/schema'
import { decryptEntries } from './crypto'
import { getNetWorth } from './net-worth'
import { detectPriceCreep } from './price-creep'

export interface DigestContent {
  user: { id: string; firstName: string; email: string }
  upcomingBills: { title: string; amountCents: number | null; date: Date; daysUntil: number }[]
  expiredCards: { title: string }[]
  expiringSoonCards: { title: string; date: Date; daysUntil: number }[]
  netWorthCurrentCents: number
  netWorthDeltaCents: number | null
  priceCreepAlerts: {
    title: string
    prevAmountCents: number
    currentAmountCents: number
    pctChange: number
  }[]
  /** True if there's literally nothing to say — caller can skip sending. */
  isEmpty: boolean
}

function parseExpiry(s: string): Date | null {
  const trimmed = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(trimmed)
  if (m) {
    const month = parseInt(m[1]) - 1
    let year = parseInt(m[2])
    if (year < 100) year += 2000
    return new Date(year, month + 1, 0)
  }
  m = /^(\d{4})-(\d{1,2})$/.exec(trimmed)
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]), 0)
  return null
}

function parseRenewsAt(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim())
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
  return null
}

/**
 * Build a personal weekly digest for one user. Returns null if the user
 * has no email on file.
 */
export async function buildWeeklyDigest(userId: string): Promise<DigestContent | null> {
  const u = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .then((r) => r[0])
  if (!u || !u.email) return null

  const firstName = (u.name ?? '').split(' ')[0] || 'there'
  const isSuperuser = u.role === 'superuser'

  // Pull entries this user can see.
  const rawEntries = await db
    .select()
    .from(entries)
    .where(and(
      isSuperuser ? undefined : eq(entries.isPrivate, false),
      or(eq(entries.isPersonal, false), eq(entries.createdBy, u.id)),
      isNull(entries.parentEntryId),
    ))
  const decrypted = decryptEntries(rawEntries)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  const sevenDaysOut = new Date(todayMs + 7 * 86_400_000)
  const thirtyDaysOut = new Date(todayMs + 30 * 86_400_000)

  // Bills due in next 7 days.
  const upcomingBills: DigestContent['upcomingBills'] = []
  // Expired cards.
  const expiredCards: DigestContent['expiredCards'] = []
  // Cards expiring in next 30 days (heads-up).
  const expiringSoonCards: DigestContent['expiringSoonCards'] = []

  for (const e of decrypted) {
    if (e.isRecurring && e.subscriptionRenewsAt) {
      const d = parseRenewsAt(e.subscriptionRenewsAt)
      if (d && d.getTime() >= todayMs && d.getTime() <= sevenDaysOut.getTime()) {
        upcomingBills.push({
          title: e.title,
          amountCents: e.subscriptionAmountCents,
          date: d,
          daysUntil: Math.round((d.getTime() - todayMs) / 86_400_000),
        })
      }
    }
    if ((e.type === 'credit_card' || e.type === 'bank_account') && e.expiryDate) {
      const d = parseExpiry(e.expiryDate)
      if (d) {
        if (d.getTime() < todayMs) {
          expiredCards.push({ title: e.title })
        } else if (d.getTime() <= thirtyDaysOut.getTime()) {
          expiringSoonCards.push({
            title: e.title,
            date: d,
            daysUntil: Math.round((d.getTime() - todayMs) / 86_400_000),
          })
        }
      }
    }
  }

  upcomingBills.sort((a, b) => a.daysUntil - b.daysUntil)
  expiringSoonCards.sort((a, b) => a.daysUntil - b.daysUntil)

  // Net worth + delta.
  const nw = await getNetWorth(u.id, u.role ?? 'readonly')
  const netWorthDeltaCents = nw.prevTotalCents != null ? nw.totalCents - nw.prevTotalCents : null

  // Price-creep alerts.
  const priceCreepRaw = await detectPriceCreep(u.id, u.role ?? 'readonly')
  const priceCreepAlerts = priceCreepRaw.map((a) => ({
    title: a.title,
    prevAmountCents: a.prevAmountCents,
    currentAmountCents: a.currentAmountCents,
    pctChange: a.pctChange,
  }))

  const isEmpty =
    upcomingBills.length === 0 &&
    expiredCards.length === 0 &&
    expiringSoonCards.length === 0 &&
    priceCreepAlerts.length === 0 &&
    (netWorthDeltaCents == null || Math.abs(netWorthDeltaCents) < 100)

  return {
    user: { id: u.id, firstName, email: u.email },
    upcomingBills,
    expiredCards,
    expiringSoonCards,
    netWorthCurrentCents: nw.totalCents,
    netWorthDeltaCents,
    priceCreepAlerts,
    isEmpty,
  }
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Render the digest to plain text + HTML for email. Returns null if the
 * digest is empty (caller can skip sending).
 */
export function renderDigest(digest: DigestContent, baseUrl: string): {
  subject: string
  text: string
  html: string
} | null {
  if (digest.isEmpty) return null

  const sections: string[] = []
  const htmlSections: string[] = []

  // ─── Net-worth delta ─────────────────────────────────────────────────────
  if (digest.netWorthDeltaCents != null && Math.abs(digest.netWorthDeltaCents) >= 100) {
    const delta = digest.netWorthDeltaCents
    const sign = delta >= 0 ? '+' : '−'
    sections.push(`Net worth: ${formatCents(digest.netWorthCurrentCents)} (${sign}${formatCents(Math.abs(delta))} since last month)`)
    const tone = delta >= 0 ? '#10b981' : '#ef4444'
    htmlSections.push(`
      <div style="margin-bottom:18px;padding:14px;background:#f0fdf4;border-radius:10px;border-left:4px solid ${tone};">
        <p style="margin:0 0 4px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#047857;">Net worth</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:#0c4a6e;">${formatCents(digest.netWorthCurrentCents)}</p>
        <p style="margin:4px 0 0 0;font-size:12px;color:${tone};">${sign}${formatCents(Math.abs(delta))} since last month</p>
      </div>
    `)
  }

  // ─── Price creep ─────────────────────────────────────────────────────────
  if (digest.priceCreepAlerts.length > 0) {
    sections.push(`\nPrice-creep alerts (${digest.priceCreepAlerts.length}):`)
    for (const a of digest.priceCreepAlerts) {
      sections.push(`  • ${a.title}: ${formatCents(a.prevAmountCents)} → ${formatCents(a.currentAmountCents)} (+${Math.round(a.pctChange * 100)}%)`)
    }
    htmlSections.push(`
      <div style="margin-bottom:18px;padding:14px;background:#fffbeb;border-radius:10px;border-left:4px solid #f59e0b;">
        <p style="margin:0 0 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#92400e;font-weight:600;">⚠ Price-creep alert</p>
        ${digest.priceCreepAlerts.map((a) => `
          <p style="margin:4px 0;font-size:13px;color:#78350f;">
            <strong>${escapeHtml(a.title)}</strong>: ${formatCents(a.prevAmountCents)} → <strong>${formatCents(a.currentAmountCents)}</strong>
            <span style="color:#b45309;"> (+${Math.round(a.pctChange * 100)}%)</span>
          </p>
        `).join('')}
      </div>
    `)
  }

  // ─── Bills due ──────────────────────────────────────────────────────────
  if (digest.upcomingBills.length > 0) {
    sections.push(`\nDue this week (${digest.upcomingBills.length}):`)
    for (const b of digest.upcomingBills) {
      const amt = b.amountCents != null ? ` ${formatCents(b.amountCents)}` : ''
      sections.push(`  • ${b.title} —${amt} on ${formatDate(b.date)} (${b.daysUntil === 0 ? 'today' : b.daysUntil === 1 ? 'tomorrow' : `in ${b.daysUntil} days`})`)
    }
    htmlSections.push(`
      <div style="margin-bottom:18px;padding:14px;background:#f8fafc;border-radius:10px;border-left:4px solid #0284c7;">
        <p style="margin:0 0 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#075985;font-weight:600;">Due this week</p>
        ${digest.upcomingBills.map((b) => {
          const amt = b.amountCents != null ? formatCents(b.amountCents) : ''
          const when = b.daysUntil === 0 ? 'today' : b.daysUntil === 1 ? 'tomorrow' : `in ${b.daysUntil} days`
          return `<p style="margin:4px 0;font-size:13px;color:#1e293b;">
            <strong>${escapeHtml(b.title)}</strong> ${amt ? `<span style="color:#0284c7;">${amt}</span>` : ''}
            <span style="color:#64748b;"> — ${when}</span>
          </p>`
        }).join('')}
      </div>
    `)
  }

  // ─── Expired cards ──────────────────────────────────────────────────────
  if (digest.expiredCards.length > 0) {
    sections.push(`\nExpired cards (${digest.expiredCards.length}):`)
    for (const c of digest.expiredCards) sections.push(`  • ${c.title}`)
    htmlSections.push(`
      <div style="margin-bottom:18px;padding:14px;background:#fef2f2;border-radius:10px;border-left:4px solid #ef4444;">
        <p style="margin:0 0 8px 0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#991b1b;font-weight:600;">Expired cards</p>
        ${digest.expiredCards.map((c) => `<p style="margin:2px 0;font-size:13px;color:#7f1d1d;">${escapeHtml(c.title)}</p>`).join('')}
      </div>
    `)
  }

  // ─── Expiring soon ──────────────────────────────────────────────────────
  if (digest.expiringSoonCards.length > 0) {
    sections.push(`\nExpiring within 30 days (${digest.expiringSoonCards.length}):`)
    for (const c of digest.expiringSoonCards) sections.push(`  • ${c.title} — ${formatDate(c.date)} (${c.daysUntil} days)`)
  }

  const greeting = `Hi ${digest.user.firstName},`
  const intro = "Here's what's on the vault's radar this week."
  const footer = `\nOpen the vault: ${baseUrl}/dashboard`

  const text = [greeting, '', intro, '', ...sections, footer].join('\n')

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1917;max-width:580px;margin:0 auto;padding:24px;background:#ffffff;">
    <h1 style="font-size:20px;margin:0 0 8px 0;color:#0c4a6e;">Vault digest</h1>
    <p style="margin:0 0 6px 0;color:#0c4a6e;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 18px 0;color:#475569;font-size:14px;">${escapeHtml(intro)}</p>
    ${htmlSections.join('')}
    <p style="margin:24px 0 0 0;text-align:center;">
      <a href="${baseUrl}/dashboard" style="display:inline-block;padding:10px 18px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Open the vault</a>
    </p>
  </div>`

  // Subject line — surfaces the most important thing.
  let subject = 'Vault digest'
  if (digest.priceCreepAlerts.length > 0) {
    subject = `Vault digest — ${digest.priceCreepAlerts.length} price-creep alert${digest.priceCreepAlerts.length === 1 ? '' : 's'}`
  } else if (digest.upcomingBills.length > 0) {
    subject = `Vault digest — ${digest.upcomingBills.length} bill${digest.upcomingBills.length === 1 ? '' : 's'} due this week`
  } else if (digest.expiredCards.length > 0) {
    subject = `Vault digest — ${digest.expiredCards.length} expired card${digest.expiredCards.length === 1 ? '' : 's'}`
  }

  return { subject, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
