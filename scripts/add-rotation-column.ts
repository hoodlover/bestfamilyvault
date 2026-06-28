// One-shot: add the `rotation` column to the `file` table when
// drizzle-kit push silently skipped it. Idempotent — IF NOT EXISTS.
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  await db.execute(sql`
    ALTER TABLE "file"
    ADD COLUMN IF NOT EXISTS "rotation" integer NOT NULL DEFAULT 0
  `)
  console.log('✅ rotation column ensured.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
