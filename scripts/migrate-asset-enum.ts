// One-shot: add 'asset' to the entry_type enum.
//
// drizzle-kit push has known limitations around enum value additions
// (Postgres won't ALTER TYPE … ADD VALUE inside a transaction, which
// drizzle-kit prefers). This script runs the ALTER TYPE directly with
// IF NOT EXISTS, so it's safe to re-run and idempotent if drizzle
// already added the value somehow.

import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  // Check current enum values first — purely informational so the user
  // can see what's already in there.
  const before = (await sql`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_type')
    ORDER BY enumsortorder
  `) as Array<{ enumlabel: string }>
  console.log('Before:', before.map((r) => r.enumlabel).join(', '))

  await sql`ALTER TYPE "entry_type" ADD VALUE IF NOT EXISTS 'asset'`
  console.log("✓ entry_type now includes 'asset'")

  const after = (await sql`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'entry_type')
    ORDER BY enumsortorder
  `) as Array<{ enumlabel: string }>
  console.log('After: ', after.map((r) => r.enumlabel).join(', '))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
