// One-shot migration: add the login_attempt table for the
// brute-force-defense rate limiter + new-device alert system.
//
// drizzle-kit push hangs against this project's Neon DB (same story
// as the push_subscription migration), so we apply the DDL by hand
// via the runtime neon client. Idempotent — guarded by IF NOT EXISTS.
//
// Run once locally + once against prod Neon:
//   npx tsx --env-file=.env.local scripts/apply-login-attempt-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS "login_attempt" (
    "id" text PRIMARY KEY NOT NULL,
    "ip" text NOT NULL,
    "email" text NOT NULL,
    "succeeded" boolean NOT NULL,
    "user_agent" text,
    "attempted_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "login_attempt_ip_time_idx"
    ON "login_attempt" USING btree ("ip", "attempted_at")`,
  `CREATE INDEX IF NOT EXISTS "login_attempt_email_time_idx"
    ON "login_attempt" USING btree ("email", "attempted_at")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nlogin_attempt migration applied.')
})()
