// Diagnose why outbound email never sends. READ-ONLY: this script touches no
// database and changes no app state. It reports which mail env vars are present
// and runs an SMTP connection/auth check (transport.verify()) so the *real*
// error surfaces — the app's forgot-password flow swallows send failures on
// purpose (password-reset.ts), which makes a broken mailer look like "nothing
// happened, no error."
//
// Usage:
//   # Against local env (will likely report SMTP vars MISSING):
//   npx tsx --env-file=.env.local scripts/test-email.ts
//
//   # Against PRODUCTION creds — pull them from Vercel first, then point at that file:
//   vercel env pull .env.vercel.local
//   npx tsx --env-file=.env.vercel.local scripts/test-email.ts
//
//   # Also send a real test message to yourself (only if connection check passes):
//   npx tsx --env-file=.env.vercel.local scripts/test-email.ts --to lance.climb@gmail.com
//
// No secrets are printed — passwords show only as [SET] / [MISSING].

import nodemailer from 'nodemailer'

function present(v: string | undefined): string {
  return v && v.trim() !== '' ? '[SET]' : '[MISSING]'
}

function getToArg(): string | null {
  const i = process.argv.indexOf('--to')
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1].trim()
  return null
}

async function main() {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT ?? '465', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? ''

  console.log('=== Mail env report ===')
  console.log(`  SMTP_HOST            ${host ?? '[MISSING]'}`)
  console.log(`  SMTP_PORT            ${process.env.SMTP_PORT ?? '(default 465)'}`)
  console.log(`  SMTP_USER            ${present(user)}`)
  console.log(`  SMTP_PASS            ${present(pass)}`)
  console.log(`  SMTP_FROM            ${process.env.SMTP_FROM ?? '(falls back to SMTP_USER)'}`)
  console.log(`  RESEND_API(_KEY)     ${present(process.env.RESEND_API ?? process.env.RESEND_API_KEY)}`)
  console.log(
    `  NEXT_PUBLIC_APP_URL  ${
      process.env.NEXT_PUBLIC_APP_URL ?? '[MISSING] -> reset links fall back to http://localhost:3000'
    }`
  )
  console.log()

  if (!host || !user || !pass) {
    console.error('SMTP is not fully configured in this env file, so the app cannot send mail here.')
    console.error('If production is the same, that alone explains why no email has ever sent.')
    console.error('')
    console.error('To test PRODUCTION creds:  vercel env pull .env.production.local --environment=production')
    console.error('                           npx tsx --env-file=.env.production.local scripts/test-email.ts')
    process.exit(1)
  }

  const secure = port === 465
  console.log(`Connecting to ${host}:${port} (secure=${secure}) as ${user} ...`)
  const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } })

  try {
    await transport.verify()
    console.log('SMTP connection + auth OK  (transport.verify() succeeded).')
  } catch (err) {
    console.error('SMTP verify() FAILED — this is the real error the app hides:')
    console.error(err)
    process.exit(1)
  }

  const to = getToArg()
  if (!to) {
    console.log()
    console.log('Connection works. Re-run with  --to you@example.com  to send a real test message.')
    return
  }

  console.log(`Sending test message to ${to} ...`)
  try {
    const info = await transport.sendMail({
      from,
      to,
      subject: 'Cobb Vault SMTP test',
      text: 'If you can read this, outbound email from Cobb Vault works.',
    })
    console.log('sendMail returned. Server response:')
    console.log(`  messageId: ${info.messageId}`)
    console.log(`  accepted:  ${JSON.stringify(info.accepted)}`)
    console.log(`  rejected:  ${JSON.stringify(info.rejected)}`)
    console.log(`  response:  ${info.response}`)
    console.log('')
    console.log('Check the inbox AND spam. If "accepted" but it never arrives, the problem is')
    console.log('delivery/domain reputation (SPF/DKIM/DMARC), not the app code.')
  } catch (err) {
    console.error('sendMail FAILED:')
    console.error(err)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
