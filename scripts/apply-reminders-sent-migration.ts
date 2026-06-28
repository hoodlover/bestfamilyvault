// One-shot DDL for the reminders_sent table (Phase 2 + Phase 3 idempotency).
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-reminders-sent-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "reminders_sent" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "kind" text NOT NULL,
    "for_date" text NOT NULL,
    "entry_id" text,
    "sent_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'reminders_sent_user_id_user_id_fk'
    ) THEN
      ALTER TABLE "reminders_sent"
        ADD CONSTRAINT "reminders_sent_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "reminders_sent_lookup_idx"
    ON "reminders_sent" USING btree ("user_id", "kind", "for_date")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nreminders_sent migration applied.')
})()
