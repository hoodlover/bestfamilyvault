// One-shot migration to create the push_subscription table + indexes.
//
// drizzle-kit push hangs against this project's Neon DB (pg driver times
// out, neon-serverless driver doesn't work for kit). Easier to apply the
// single DDL block by hand via the runtime neon client.
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-push-migration.ts
//
// Idempotent — guarded by IF NOT EXISTS so a re-run is safe.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "push_subscription" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "endpoint" text NOT NULL,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "user_agent" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "last_used_at" timestamp,
    "last_error_at" timestamp,
    "failure_count" integer DEFAULT 0 NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'push_subscription_user_id_user_id_fk'
    ) THEN
      ALTER TABLE "push_subscription"
        ADD CONSTRAINT "push_subscription_user_id_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
    END IF;
  END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_idx"
    ON "push_subscription" USING btree ("endpoint")`,
  `CREATE INDEX IF NOT EXISTS "push_subscription_user_idx"
    ON "push_subscription" USING btree ("user_id")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\npush_subscription migration applied.')
})()
