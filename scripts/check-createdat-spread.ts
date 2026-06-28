import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  const r = await db.execute(sql`
    SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*) AS n
    FROM entry
    GROUP BY month
    ORDER BY month
  `)
  for (const row of r.rows) {
    console.log(`${row.month}: ${row.n}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
