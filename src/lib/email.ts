import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { APP_NAME } from './branding'

// SMTP-based mailer. Originally wired for Resend's HTTP API; switched to
// nodemailer + SMTP so we can send through forwardemail.net (no separate
// transactional-email account required — same domain, same provider that
// handles inbound forwarding for the app domain).
//
// Required env vars (set in Vercel production env):
//   SMTP_HOST   smtp.forwardemail.net
//   SMTP_PORT   465 (or 587 for STARTTLS)
//   SMTP_USER   the full sending mailbox, e.g. noreply@example.com
//   SMTP_PASS   the SMTP password generated in forwardemail's dashboard
//                — NOT the account password; a per-mailbox SMTP credential
//   SMTP_FROM   "Family Vault <noreply@example.com>"  (optional;
//                falls back to SMTP_USER if unset)

let cachedTransport: Transporter | null = null

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport

  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT ?? '465', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP env vars are not set. Need SMTP_HOST, SMTP_USER, SMTP_PASS ' +
        '(and optionally SMTP_PORT, SMTP_FROM) in Vercel production env. ' +
        'Generate the SMTP password in your forwardemail.net dashboard.'
    )
  }

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    // Port 465 is implicit TLS; everything else (e.g. 587) negotiates via STARTTLS.
    secure: port === 465,
    auth: { user, pass },
  })

  return cachedTransport
}

function getFrom(): string {
  return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? ''
}

/**
 * Generic raw-email sender. Used by the weekly-digest cron and any
 * other one-off notifications that don't warrant their own helper.
 */
export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html: string
}): Promise<void> {
  const transport = getTransport()
  await transport.sendMail({
    from: getFrom(),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  })
}

interface SendPasswordResetParams {
  to: string
  firstName: string
  resetUrl: string
}

export async function sendPasswordResetEmail({
  to, firstName, resetUrl,
}: SendPasswordResetParams): Promise<void> {
  const transport = getTransport()

  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const text = [
    greeting,
    '',
    `Someone (hopefully you) asked to reset your ${APP_NAME} password.`,
    '',
    'Click this link to set a new one:',
    resetUrl,
    '',
    "The link works once and expires in 1 hour. If this wasn't you,",
    'just ignore this email — your current password keeps working.',
    '',
    `— ${APP_NAME}`,
  ].join('\n')

  const safeUrl = escapeAttr(resetUrl)
  const safeName = escapeHtml(APP_NAME)
  const safeGreeting = escapeHtml(greeting)
  const safeUrlText = escapeHtml(resetUrl)

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1917;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:18px;margin:0 0 16px 0;">Reset your ${safeName} password</h1>
<p>${safeGreeting}</p>
<p>Someone (hopefully you) asked to reset your password.</p>
<p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Set a new password</a></p>
<p style="font-size:13px;color:#57534e;">Or copy this link: <br><a href="${safeUrl}" style="color:#047857;word-break:break-all;">${safeUrlText}</a></p>
<p style="font-size:13px;color:#57534e;">The link works once and expires in 1 hour. If this wasn't you, just ignore this email — your current password keeps working.</p>
<p style="font-size:13px;color:#78716c;">— ${safeName}</p>
</div>`

  await transport.sendMail({
    from: getFrom(),
    to,
    subject: `Reset your ${APP_NAME} password`,
    text,
    html,
  })
}

interface SendMessageNotificationParams {
  to: string
  firstName: string
  senderName: string
  /** Plain-text preview of the message body. Pass null for voice-only. */
  bodyPreview: string | null
  hasVoiceMemo: boolean
  messagesUrl: string
}

export async function sendMessageNotificationEmail({
  to, firstName, senderName, bodyPreview, hasVoiceMemo, messagesUrl,
}: SendMessageNotificationParams): Promise<void> {
  const transport = getTransport()

  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const what = hasVoiceMemo && bodyPreview
    ? 'sent you a message and a voice memo'
    : hasVoiceMemo
    ? 'sent you a voice memo'
    : 'sent you a message'

  const truncated = bodyPreview && bodyPreview.length > 240
    ? bodyPreview.slice(0, 240).trimEnd() + '…'
    : bodyPreview

  const subject = hasVoiceMemo && !bodyPreview
    ? `New voice memo from ${senderName}`
    : `New message from ${senderName}`

  const text = [
    greeting,
    '',
    `${senderName} ${what} in ${APP_NAME}.`,
    truncated ? '' : null,
    truncated ? `> ${truncated.replace(/\n/g, '\n> ')}` : null,
    '',
    'Open it here:',
    messagesUrl,
    '',
    `— ${APP_NAME}`,
  ].filter((line) => line !== null).join('\n')

  const safeName = escapeHtml(APP_NAME)
  const safeGreeting = escapeHtml(greeting)
  const safeSender = escapeHtml(senderName)
  const safeWhat = escapeHtml(what)
  const safeUrl = escapeAttr(messagesUrl)
  const safeUrlText = escapeHtml(messagesUrl)
  const safePreview = truncated ? escapeHtml(truncated).replace(/\n/g, '<br>') : null

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1917;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:18px;margin:0 0 16px 0;">${safeSender} ${safeWhat}</h1>
<p>${safeGreeting}</p>
<p>${safeSender} ${safeWhat} in ${safeName}.</p>
${safePreview ? `<blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #047857;background:#f5f4f0;color:#44403c;font-size:14px;border-radius:4px;">${safePreview}</blockquote>` : ''}
<p><a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open ${safeName}</a></p>
<p style="font-size:13px;color:#57534e;">Or copy this link: <br><a href="${safeUrl}" style="color:#047857;word-break:break-all;">${safeUrlText}</a></p>
<p style="font-size:13px;color:#78716c;">— ${safeName}</p>
</div>`

  await transport.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
    html,
  })
}

interface SendFeatureRequestParams {
  /** Recipient (vault admin). */
  to: string
  /** Submitter's display name (or email if name is unset). */
  fromName: string
  /** Submitter's email — populated as the Reply-To so Lance can hit reply. */
  fromEmail: string | null
  /** What the user typed. */
  message: string
  /** Public URL of the deployment, for the "open vault" link. */
  appUrl: string
}

export async function sendFeatureRequestEmail({
  to, fromName, fromEmail, message, appUrl,
}: SendFeatureRequestParams): Promise<void> {
  const transport = getTransport()

  const subject = `[${APP_NAME}] Feature request from ${fromName}`
  const trimmed = message.trim().slice(0, 4000)

  const text = [
    `${fromName}${fromEmail ? ` (${fromEmail})` : ''} sent a feature request from ${APP_NAME}.`,
    '',
    '--- Message ---',
    trimmed,
    '--- End message ---',
    '',
    `Vault: ${appUrl}`,
  ].join('\n')

  const safeName = escapeHtml(APP_NAME)
  const safeFrom = escapeHtml(fromName)
  const safeFromEmail = fromEmail ? escapeHtml(fromEmail) : null
  const safeMessage = escapeHtml(trimmed).replace(/\n/g, '<br>')
  const safeUrl = escapeAttr(appUrl)
  const safeUrlText = escapeHtml(appUrl)

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1917;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:18px;margin:0 0 16px 0;">Feature request from ${safeFrom}</h1>
<p style="font-size:14px;color:#57534e;margin:0 0 12px 0;">${safeFromEmail ? `Reply-to: <a href="mailto:${safeFromEmail}" style="color:#047857;">${safeFromEmail}</a>` : 'No email on file for this user.'}</p>
<blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #047857;background:#f5f4f0;color:#44403c;font-size:14px;border-radius:4px;white-space:pre-wrap;">${safeMessage}</blockquote>
<p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;">Open ${safeName}</a></p>
<p style="font-size:12px;color:#78716c;margin-top:24px;">Sent automatically by ${safeName} when a family member tapped &ldquo;Request a feature&rdquo; in the user menu. Reply to this email to respond directly to the requester (their address is in the Reply-To header). Vault link: <a href="${safeUrl}" style="color:#047857;word-break:break-all;">${safeUrlText}</a></p>
</div>`

  await transport.sendMail({
    from: getFrom(),
    to,
    subject,
    text,
    html,
    replyTo: fromEmail ?? undefined,
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
