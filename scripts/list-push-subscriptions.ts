// Diagnostic: show every device currently subscribed to push for each
// user. Useful for confirming a new phone landed in push_subscription
// after the user tapped "Enable reminders".
//
// Run: npx tsx --env-file=.env.local scripts/list-push-subscriptions.ts
//
// Optional: pass an email to filter to one user.
//   npx tsx --env-file=.env.local scripts/list-push-subscriptions.ts lance.climb@gmail.com

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — pass --env-file=.env.local')
  process.exit(1)
}
const sql = neon(url)
const filterEmail = process.argv[2] || null

// Coarse device-family detection from the User-Agent string. Chrome
// 128+ strips device model codes from the UA for privacy (you get
// "Android 10; K" on every modern Android phone — same string on an
// S25, Pixel 8, or anything else). We can only tell platform, not
// model. If Lance ever wants real labels, the subscribe path needs to
// call navigator.userAgentData.getHighEntropyValues(['model']) and
// store the result alongside the UA.
function deviceFamily(ua: string | null): string {
  if (!ua) return '(no UA)'
  if (/SM-S/.test(ua))         return 'Samsung Galaxy (legacy UA)'
  if (/iPhone/.test(ua))       return 'iPhone'
  if (/iPad/.test(ua))         return 'iPad'
  if (/Android/.test(ua))      return 'Android phone'
  if (/Macintosh/.test(ua))    return 'Mac'
  if (/Windows/.test(ua))      return 'Windows desktop'
  return ua.slice(0, 60)
}

;(async () => {
  const rows = await sql.query(`
    SELECT
      ps.id,
      ps.user_agent,
      ps.created_at,
      ps.last_used_at,
      ps.last_error_at,
      ps.failure_count,
      ps.endpoint,
      u.email
    FROM push_subscription ps
    LEFT JOIN "user" u ON u.id = ps.user_id
    ${filterEmail ? `WHERE u.email = $1` : ''}
    ORDER BY u.email, ps.created_at DESC
  `, filterEmail ? [filterEmail] : []) as Array<{
    id: string
    user_agent: string | null
    created_at: Date
    last_used_at: Date | null
    last_error_at: Date | null
    failure_count: number
    endpoint: string
    email: string | null
  }>

  if (rows.length === 0) {
    console.log(filterEmail
      ? `No push subscriptions for ${filterEmail}.`
      : 'No push subscriptions in the database.')
    console.log('\nIf you just tapped "Enable reminders" and don\'t see your device here:')
    console.log('  1. Confirm the toggle says "Reminders are on for this device."')
    console.log('  2. Check the browser console for [push] errors when you tapped Enable.')
    console.log('  3. Push services route through Google FCM — corporate or school networks sometimes block them.')
    return
  }

  let currentEmail: string | null | undefined = undefined
  for (const r of rows) {
    if (r.email !== currentEmail) {
      console.log(`\n${r.email ?? '(no email)'}`)
      currentEmail = r.email
    }
    const device = deviceFamily(r.user_agent)
    const created = r.created_at.toISOString().slice(0, 10)
    const lastUsed = r.last_used_at ? r.last_used_at.toISOString().slice(0, 10) : 'never'
    const fail = r.failure_count > 0 ? `  ⚠ ${r.failure_count} failures` : ''
    console.log(`  · ${device.padEnd(28)}  added ${created}  last push ${lastUsed}${fail}`)
    // Show first 60 chars of the endpoint so you can correlate with
    // dup subscriptions (same device that re-subscribed after clearing
    // the SW will have a different endpoint).
    console.log(`    ${r.endpoint.slice(0, 60)}...`)
  }
  console.log(`\nTotal: ${rows.length} subscription${rows.length === 1 ? '' : 's'}.`)
})()
