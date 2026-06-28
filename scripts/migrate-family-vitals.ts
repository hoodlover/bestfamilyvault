// One-shot: ensure the v258 Family Info popout columns exist on the
// user table. drizzle-kit push silently exits without applying changes
// in some cases (it happened with the asset enum addition earlier), so
// this is a belt-and-suspenders ALTER TABLE … ADD COLUMN IF NOT EXISTS
// pair that is safe to re-run any number of times.
//
// Run with: npx tsx --env-file=.env.local scripts/migrate-family-vitals.ts

import { neon } from '@neondatabase/serverless'

async function run() {
  const sql = neon(process.env.DATABASE_URL!)

  // Snapshot which columns exist BEFORE the ALTERs so the output makes
  // it obvious whether the prior db:push already landed them.
  const before = (await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name IN ('drivers_license_expiry', 'anniversary')
    ORDER BY column_name
  `) as Array<{ column_name: string }>
  console.log('Before:', before.length === 0 ? '(neither column present)' : before.map((r) => r.column_name).join(', '))

  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "drivers_license_expiry" text`
  console.log('✓ user.drivers_license_expiry')

  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "anniversary" text`
  console.log('✓ user.anniversary')

  const after = (await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user'
      AND column_name IN ('drivers_license_expiry', 'anniversary')
    ORDER BY column_name
  `) as Array<{ column_name: string }>
  console.log('After: ', after.map((r) => r.column_name).join(', '))
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
