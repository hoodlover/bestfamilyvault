// Per-user Gmail contacts sync. Two new tables:
//
//   • gmail_link        — one row per user holding the OAuth tokens, sync
//                         frequency, last-synced timestamp, and the People
//                         API syncToken for incremental pulls.
//
//   • gmail_contact     — the actual contact rows. Each contact belongs to
//                         exactly one user (no sharing across the family).
//                         googleResourceName matches the contact in Gmail
//                         so we can update / delete / dedupe on sync.
//
// Idempotent — IF NOT EXISTS guards on every CREATE so re-running is safe.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-gmail-contacts.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  // 1. gmail_link — one row per user. Holds OAuth tokens + sync state.
  // userId is the primary key (each user can only link one Gmail), making
  // upsert-on-reconnect dead simple.
  await sql`
    CREATE TABLE IF NOT EXISTS gmail_link (
      user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      gmail_email text NOT NULL,
      access_token text NOT NULL,
      refresh_token text NOT NULL,
      access_token_expires_at timestamp,
      scope text,
      sync_frequency text NOT NULL DEFAULT 'manual',
      sync_token text,
      last_synced_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `

  // 2. gmail_contact — flat list of contact rows scoped per user.
  // syncStatus controls the push direction: 'synced' = nothing to push;
  // 'local_created' / 'local_modified' / 'pending_delete' = needs to go
  // to Gmail on the next sync. google_resource_name is null until we
  // successfully push a vault-created contact.
  await sql`
    CREATE TABLE IF NOT EXISTS gmail_contact (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      google_resource_name text,
      google_etag text,
      display_name text,
      given_name text,
      family_name text,
      emails json DEFAULT '[]'::json,
      phones json DEFAULT '[]'::json,
      addresses json DEFAULT '[]'::json,
      organization text,
      job_title text,
      birthday text,
      notes text,
      sync_status text NOT NULL DEFAULT 'synced',
      deleted_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS gmail_contact_user_idx ON gmail_contact(user_id)`
  // Unique on (user_id, google_resource_name) so a remote upsert doesn't
  // accidentally insert duplicates. Allows multiple null resource_names per
  // user (one per vault-created-but-not-yet-pushed contact).
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS gmail_contact_user_resource_idx
      ON gmail_contact(user_id, google_resource_name)
      WHERE google_resource_name IS NOT NULL
  `

  console.log('Migration complete. Tables ready: gmail_link, gmail_contact.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
