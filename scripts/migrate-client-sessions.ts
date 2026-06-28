// Adds the two tables that back the autofill / browser-extension API:
//
//   • client_session   — one row per paired browser / phone. Holds the
//                        bearer-token hash and platform metadata. Used by
//                        the Bearer-auth middleware on /api/clients/*.
//   • client_pair_code — short-lived 6-digit codes for the pairing
//                        handshake. Inserted by /api/clients/pair/start
//                        (web session), consumed by .../pair/complete
//                        (anonymous, code in body).
//
// Idempotent — safe to re-run.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-client-sessions.ts

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

async function run() {
  // 1. client_session — paired clients (extensions, mobile apps).
  // tokenHash is SHA-256(token); the plaintext token is returned to the
  // client only once at pair time, then never persisted server-side.
  // Unique index on tokenHash so token lookup is O(log n).
  await sql`
    CREATE TABLE IF NOT EXISTS client_session (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name text NOT NULL,
      platform text NOT NULL,
      token_hash text NOT NULL,
      last_seen_at timestamp,
      revoked_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS client_session_user_idx ON client_session(user_id)`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS client_session_token_hash_idx ON client_session(token_hash)`

  // 2. client_pair_code — short-lived 6-digit codes. Code itself is the
  // primary key so re-issuing the same digits while one is still active
  // is a no-op (we'll generate fresh codes on collision in the route).
  await sql`
    CREATE TABLE IF NOT EXISTS client_pair_code (
      code text PRIMARY KEY,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      expires_at timestamp NOT NULL,
      consumed_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS client_pair_code_user_idx ON client_pair_code(user_id)`

  console.log('Migration complete. Tables ready: client_session, client_pair_code.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
