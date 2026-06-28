// One-shot DDL: add content_hash column + index to the file table.
//
// Run: npx tsx --env-file=.env.local scripts/apply-file-hash-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — pass --env-file=.env.local')
  process.exit(1)
}
const sql = neon(url)

const statements = [
  `ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "content_hash" text`,
  `CREATE INDEX IF NOT EXISTS "file_uploaded_by_hash_idx"
    ON "file" USING btree ("uploaded_by", "content_hash")`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\ncontent_hash migration applied.')
})()
