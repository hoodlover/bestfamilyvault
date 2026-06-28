// One-shot DDL for the statement_line_decision table + the
// statement_line_decision_kind enum. Backs the /reconcile page.
//
// Run: npx tsx --env-file=.env.local scripts/apply-statement-line-decision-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

// Each statement is idempotent (IF NOT EXISTS / DO $$ guards) so the
// script is safe to re-run; same pattern as the other apply-*-migration
// scripts in this folder.
const statements = [
  // Enum first — table column references it.
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statement_line_decision_kind') THEN
      CREATE TYPE "statement_line_decision_kind" AS ENUM (
        'matched',
        'no_receipt_needed',
        'personal',
        'transfer',
        'atm_cash'
      );
    END IF;
  END $$`,

  `CREATE TABLE IF NOT EXISTS "statement_line_decision" (
    "statement_line_item_id" text PRIMARY KEY NOT NULL,
    "decision" "statement_line_decision_kind" NOT NULL,
    "receipt_entry_id" text,
    "note" text,
    "decided_by" text NOT NULL,
    "decided_at" timestamp DEFAULT now() NOT NULL
  )`,

  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'statement_line_decision_statement_line_item_id_fk'
    ) THEN
      ALTER TABLE "statement_line_decision"
        ADD CONSTRAINT "statement_line_decision_statement_line_item_id_fk"
        FOREIGN KEY ("statement_line_item_id")
        REFERENCES "statement_line_item"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'statement_line_decision_receipt_entry_id_fk'
    ) THEN
      ALTER TABLE "statement_line_decision"
        ADD CONSTRAINT "statement_line_decision_receipt_entry_id_fk"
        FOREIGN KEY ("receipt_entry_id")
        REFERENCES "entry"("id") ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'statement_line_decision_decided_by_fk'
    ) THEN
      ALTER TABLE "statement_line_decision"
        ADD CONSTRAINT "statement_line_decision_decided_by_fk"
        FOREIGN KEY ("decided_by")
        REFERENCES "user"("id") ON DELETE SET NULL;
    END IF;
  END $$`,

  `CREATE INDEX IF NOT EXISTS "statement_line_decision_decision_idx"
    ON "statement_line_decision" USING btree ("decision")`,
  `CREATE INDEX IF NOT EXISTS "statement_line_decision_receipt_idx"
    ON "statement_line_decision" USING btree ("receipt_entry_id")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nstatement_line_decision migration applied.')
})()
