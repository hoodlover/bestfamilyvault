// One-shot: add 'app_login' to the entry_type enum.
//
// drizzle-kit push has known limitations around enum value additions
// (Postgres won't ALTER TYPE … ADD VALUE inside a transaction, which
// drizzle-kit prefers). This script runs the ALTER TYPE directly with
// IF NOT EXISTS, so it's safe to re-run and idempotent if drizzle
// already added the value somehow.
//
// Run with:  npx tsx --env-file=.env.local scripts/migrate-app-login-enum.ts
// (the --env-file flag is what the rest of this repo's tsx scripts use —
// without it DATABASE_URL won't be loaded and the neon() factory throws.)

import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  const before = (await sql`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_type')
    ORDER BY enumsortorder
  `) as Array<{ enumlabel: string }>
  console.log('Before:', before.map((r) => r.enumlabel).join(', '))

  await sql`ALTER TYPE "entry_type" ADD VALUE IF NOT EXISTS 'app_login'`
  console.log("✓ entry_type now includes 'app_login'")

  const after = (await sql`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_type')
    ORDER BY enumsortorder
  `) as Array<{ enumlabel: string }>
  console.log('After: ', after.map((r) => r.enumlabel).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
