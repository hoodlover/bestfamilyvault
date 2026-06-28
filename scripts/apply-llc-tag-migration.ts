// One-shot migration to add the llc_subcategory_id column to the entry
// table. Drizzle-kit push hangs against this project's Neon DB so we
// keep using the runtime client + idempotent DDL pattern from earlier
// phases.
//
// Run once:
//   npx tsx --env-file=.env.local scripts/apply-llc-tag-migration.ts

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL missing — did you pass --env-file=.env.local?')
  process.exit(1)
}
const sql = neon(url)

const statements = [
  `ALTER TABLE "entry"
    ADD COLUMN IF NOT EXISTS "llc_subcategory_id" text`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'entry_llc_subcategory_id_subcategory_id_fk'
    ) THEN
      ALTER TABLE "entry"
        ADD CONSTRAINT "entry_llc_subcategory_id_subcategory_id_fk"
        FOREIGN KEY ("llc_subcategory_id") REFERENCES "subcategory"("id") ON DELETE SET NULL;
    END IF;
  END $$`,
]

;(async () => {
  for (const stmt of statements) {
    process.stdout.write(`Running: ${stmt.slice(0, 60).replace(/\s+/g, ' ')}...`)
    await sql.query(stmt)
    process.stdout.write(' OK\n')
  }
  console.log('\nllc_subcategory_id migration applied.')
})()
