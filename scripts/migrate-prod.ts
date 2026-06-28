// One-shot idempotent migration to bring a database up to current schema
// when drizzle-kit push misbehaves (the neon pooled URL sometimes hangs
// silently). Each statement uses IF NOT EXISTS so re-running is safe.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/migrate-prod.ts
//
// Add new statements at the bottom whenever schema.ts gains a column
// or table — that way prod can be caught up without touching drizzle.

import { sql } from 'drizzle-orm'
import { db } from '../src/lib/db'

const STATEMENTS: { label: string; sql: string }[] = [
  // --- v24: birthday banner ---
  {
    label: 'user.date_of_birth',
    sql: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "date_of_birth" timestamp`,
  },

  // --- v23: time capsules ---
  {
    label: 'time_capsule table',
    sql: `CREATE TABLE IF NOT EXISTS "time_capsule" (
      "id" text PRIMARY KEY,
      "from_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "to_user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
      "title" text NOT NULL,
      "body" text NOT NULL DEFAULT '',
      "unlock_at" timestamp NOT NULL,
      "first_read_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
  },
  {
    label: 'time_capsule.to_user index',
    sql: `CREATE INDEX IF NOT EXISTS "time_capsule_to_user_idx" ON "time_capsule" ("to_user_id")`,
  },
  {
    label: 'time_capsule.unlock_at index',
    sql: `CREATE INDEX IF NOT EXISTS "time_capsule_unlock_at_idx" ON "time_capsule" ("unlock_at")`,
  },

  // --- v30: self-serve password reset ---
  {
    label: 'password_reset_token table',
    sql: `CREATE TABLE IF NOT EXISTS "password_reset_token" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "token_hash" text NOT NULL,
      "expires_at" timestamp NOT NULL,
      "consumed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`,
  },
  {
    label: 'password_reset_token index',
    sql: `CREATE INDEX IF NOT EXISTS "password_reset_token_hash_idx" ON "password_reset_token" ("token_hash")`,
  },

  // --- v34: voice memos on avatar ---
  {
    label: 'user.voice_memo_blob_url',
    sql: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "voice_memo_blob_url" text`,
  },
  {
    label: 'user.voice_memo_content_type',
    sql: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "voice_memo_content_type" text`,
  },
]

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  const host = url.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unknown)'
  console.log(`Migrating: ${host}`)
  console.log()

  for (const { label, sql: stmt } of STATEMENTS) {
    process.stdout.write(`  ${label}… `)
    try {
      // sql.raw is needed for multi-statement strings (the index pair above)
      await db.execute(sql.raw(stmt))
      console.log('ok')
    } catch (err) {
      console.log('FAILED')
      console.error('   ', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  }

  console.log()
  console.log('Done. Schema is now caught up.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
