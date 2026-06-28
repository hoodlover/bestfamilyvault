import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  const result = await db.execute(sql`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'file' AND column_name = 'rotation'
  `)
  const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? (result as unknown as Array<Record<string, unknown>>)
  if (!rows || rows.length === 0) {
    console.log('❌ rotation column NOT present on file table.')
    console.log('   Re-run: npm run db:push')
    console.log('   If that still does nothing, try: npx drizzle-kit push --verbose')
    process.exit(1)
  }
  console.log('✅ rotation column present:', rows[0])
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Check failed:', err)
    process.exit(1)
  })
