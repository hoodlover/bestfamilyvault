// Phase 2 schema additions — financial intel.
//
// 1. Adds three nullable columns to entries:
//      current_balance      integer (cents; positive for assets, negative for debts)
//      balance_as_of        timestamp (statement period end)
//      recent_activity      jsonb (most recent extracted transactions)
//
// 2. Creates balance_history table for month-over-month deltas + the
//    price-creep detector. One row per imported statement.
//
// 3. Adds calendar_token to user table — opaque per-user token for
//    subscribing to a private .ics feed.
//
// All ALTER TABLE statements use IF NOT EXISTS, so safe to re-run.

import { neon } from '@neondatabase/serverless'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)

  await sql`ALTER TABLE "entry" ADD COLUMN IF NOT EXISTS "current_balance" integer`
  console.log('✓ entry.current_balance')

  await sql`ALTER TABLE "entry" ADD COLUMN IF NOT EXISTS "balance_as_of" timestamp`
  console.log('✓ entry.balance_as_of')

  await sql`ALTER TABLE "entry" ADD COLUMN IF NOT EXISTS "recent_activity" jsonb`
  console.log('✓ entry.recent_activity')

  await sql`
    CREATE TABLE IF NOT EXISTS "balance_history" (
      "id" text PRIMARY KEY,
      "entry_id" text NOT NULL REFERENCES "entry"("id") ON DELETE CASCADE,
      "balance_cents" integer NOT NULL,
      "period_end" timestamp NOT NULL,
      "source_file_id" text REFERENCES "file"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('✓ balance_history table')

  await sql`
    CREATE INDEX IF NOT EXISTS "balance_history_entry_period_idx"
    ON "balance_history" ("entry_id", "period_end" DESC)
  `
  console.log('✓ balance_history index')

  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "calendar_token" text`
  console.log('✓ user.calendar_token')

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "user_calendar_token_idx"
    ON "user" ("calendar_token")
    WHERE "calendar_token" IS NOT NULL
  `
  console.log('✓ user_calendar_token unique partial index')

  console.log('\nDone. Existing rows are unaffected (all new columns nullable).')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
