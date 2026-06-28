// One-shot DDL for the recurring_suggestion table (Phase 4b).
//
// Run: npx tsx --env-file=.env.local scripts/apply-recurring-suggestions-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "recurring_suggestion" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "account_entry_id" text NOT NULL,
    "llc_subcategory_id" text,
    "normalized_merchant" text NOT NULL,
    "display_name" text NOT NULL,
    "typical_amount_cents" integer NOT NULL,
    "period" text NOT NULL,
    "first_seen_at" text NOT NULL,
    "last_seen_at" text NOT NULL,
    "occurrence_count" integer NOT NULL,
    "predicted_next_at" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "approved_entry_id" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_suggestion_user_id_user_id_fk') THEN
      ALTER TABLE "recurring_suggestion"
        ADD CONSTRAINT "recurring_suggestion_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_suggestion_account_entry_id_entry_id_fk') THEN
      ALTER TABLE "recurring_suggestion"
        ADD CONSTRAINT "recurring_suggestion_account_entry_id_entry_id_fk"
        FOREIGN KEY ("account_entry_id") REFERENCES "entry"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_suggestion_llc_subcategory_id_subcategory_id_fk') THEN
      ALTER TABLE "recurring_suggestion"
        ADD CONSTRAINT "recurring_suggestion_llc_subcategory_id_subcategory_id_fk"
        FOREIGN KEY ("llc_subcategory_id") REFERENCES "subcategory"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_suggestion_approved_entry_id_entry_id_fk') THEN
      ALTER TABLE "recurring_suggestion"
        ADD CONSTRAINT "recurring_suggestion_approved_entry_id_entry_id_fk"
        FOREIGN KEY ("approved_entry_id") REFERENCES "entry"("id") ON DELETE SET NULL;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "recurring_suggestion_user_status_idx"
    ON "recurring_suggestion" USING btree ("user_id", "status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "recurring_suggestion_dedup_idx"
    ON "recurring_suggestion" USING btree ("account_entry_id", "normalized_merchant")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nrecurring_suggestion migration applied.')
})()
