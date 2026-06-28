// One-shot DDL for the statement_line_item table (Phase 4b).
//
// Run: npx tsx --env-file=.env.local scripts/apply-statement-line-items-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "statement_line_item" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "account_entry_id" text NOT NULL,
    "source_file_id" text,
    "statement_date" text,
    "posted_date" text NOT NULL,
    "raw_description" text NOT NULL,
    "normalized_merchant" text NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" text DEFAULT 'USD' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statement_line_item_user_id_user_id_fk') THEN
      ALTER TABLE "statement_line_item"
        ADD CONSTRAINT "statement_line_item_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statement_line_item_account_entry_id_entry_id_fk') THEN
      ALTER TABLE "statement_line_item"
        ADD CONSTRAINT "statement_line_item_account_entry_id_entry_id_fk"
        FOREIGN KEY ("account_entry_id") REFERENCES "entry"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statement_line_item_source_file_id_file_id_fk') THEN
      ALTER TABLE "statement_line_item"
        ADD CONSTRAINT "statement_line_item_source_file_id_file_id_fk"
        FOREIGN KEY ("source_file_id") REFERENCES "file"("id") ON DELETE SET NULL;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "statement_line_item_user_merchant_idx"
    ON "statement_line_item" USING btree ("user_id", "normalized_merchant")`,
  `CREATE INDEX IF NOT EXISTS "statement_line_item_account_date_idx"
    ON "statement_line_item" USING btree ("account_entry_id", "posted_date")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "statement_line_item_dedup_idx"
    ON "statement_line_item" USING btree ("account_entry_id", "posted_date", "amount_cents", "normalized_merchant")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nstatement_line_item migration applied.')
})()
