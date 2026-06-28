// Adds is_favorite + is_priority boolean columns to the todo_item table.
// Same hand-applied DDL pattern as the other migration scripts.
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-todo-item-flags-migration.ts
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
  `ALTER TABLE "todo_item"
    ADD COLUMN IF NOT EXISTS "is_favorite" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "todo_item"
    ADD COLUMN IF NOT EXISTS "is_priority" boolean DEFAULT false NOT NULL`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 70).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\ntodo_item flag columns added.')
})()
