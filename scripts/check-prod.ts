// Runtime sanity check for prod: lists all tables, all columns on `user`,
// and confirms each table our schema expects actually exists in the DB.
// Useful when a page silently 500s and you suspect schema drift.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/check-prod.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'

const EXPECTED_TABLES = [
  'user', 'account', 'session', 'verificationToken',
  'invite', 'upgrade_request', 'password_reset_token',
  'time_capsule', 'message',
  'category', 'subcategory', 'entries',
  'notes', 'letters', 'letter_release', 'file',
]

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'
  console.log(`DB: ${host}`)
  console.log()

  // List all tables in the public schema
  const tablesRes = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )
  const rows = (tablesRes as unknown as { rows: { tablename: string }[] }).rows ?? (tablesRes as unknown as { tablename: string }[])
  const present = new Set(rows.map((r) => r.tablename))

  console.log('Tables:')
  for (const t of EXPECTED_TABLES) {
    console.log(`  ${present.has(t) ? '✓' : '✗ MISSING'}  ${t}`)
  }
  console.log()

  // List columns on `user`
  const colsRes = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user' ORDER BY ordinal_position`,
  )
  const colRows = (colsRes as unknown as { rows: { column_name: string }[] }).rows ?? (colsRes as unknown as { column_name: string }[])
  console.log('user columns:')
  for (const c of colRows) console.log(`  - ${c.column_name}`)

  // List columns on `entry` (the table that backs all login/note/bank/card/identity rows)
  const entryColsRes = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='entry' ORDER BY ordinal_position`,
  )
  const entryColRows = (entryColsRes as unknown as { rows: { column_name: string }[] }).rows ?? (entryColsRes as unknown as { column_name: string }[])
  console.log()
  console.log('entry columns:')
  for (const c of entryColRows) console.log(`  - ${c.column_name}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
