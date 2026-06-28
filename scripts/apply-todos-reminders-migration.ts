// One-shot migration that creates the todo_list, todo_item, and reminder
// tables + their indexes. Same hand-applied DDL pattern as the other
// scripts in this directory — drizzle-kit push hangs against Neon.
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-todos-reminders-migration.ts
//
// Idempotent — guarded by IF NOT EXISTS so a re-run is a no-op.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "todo_list" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "title" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'todo_list_user_id_user_id_fk'
    ) THEN
      ALTER TABLE "todo_list"
        ADD CONSTRAINT "todo_list_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "todo_list_user_updated_idx"
    ON "todo_list" USING btree ("user_id", "updated_at")`,

  `CREATE TABLE IF NOT EXISTS "todo_item" (
    "id" text PRIMARY KEY NOT NULL,
    "list_id" text NOT NULL,
    "text" text DEFAULT '' NOT NULL,
    "is_checked" boolean DEFAULT false NOT NULL,
    "sort_order" real DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'todo_item_list_id_todo_list_id_fk'
    ) THEN
      ALTER TABLE "todo_item"
        ADD CONSTRAINT "todo_item_list_id_todo_list_id_fk"
        FOREIGN KEY ("list_id") REFERENCES "todo_list"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "todo_item_list_idx"
    ON "todo_item" USING btree ("list_id")`,

  `CREATE TABLE IF NOT EXISTS "reminder" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "title" text NOT NULL,
    "body" text,
    "note_id" text,
    "todo_list_id" text,
    "remind_at" timestamp NOT NULL,
    "sent_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'reminder_user_id_user_id_fk'
    ) THEN
      ALTER TABLE "reminder"
        ADD CONSTRAINT "reminder_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'reminder_note_id_note_id_fk'
    ) THEN
      ALTER TABLE "reminder"
        ADD CONSTRAINT "reminder_note_id_note_id_fk"
        FOREIGN KEY ("note_id") REFERENCES "note"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'reminder_todo_list_id_todo_list_id_fk'
    ) THEN
      ALTER TABLE "reminder"
        ADD CONSTRAINT "reminder_todo_list_id_todo_list_id_fk"
        FOREIGN KEY ("todo_list_id") REFERENCES "todo_list"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "reminder_user_idx"
    ON "reminder" USING btree ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "reminder_remind_at_idx"
    ON "reminder" USING btree ("remind_at")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\ntodo + reminder migration applied.')
})()
