// Adds is_favorite + is_priority boolean columns to the todo_list table.
// (Lance moved these flags off individual items up to the list level —
// the matching todo_item columns are no longer read by the app but
// haven't been dropped to avoid destructive churn.)
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-todo-list-flags-migration.ts
//
// Idempotent — IF NOT EXISTS guards on every column add.

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}

const sql = neon(url)

const statements = [
  `ALTER TABLE "todo_list"
    ADD COLUMN IF NOT EXISTS "is_favorite" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "todo_list"
    ADD COLUMN IF NOT EXISTS "is_priority" boolean DEFAULT false NOT NULL`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\ntodo_list flag columns added.')
})()
